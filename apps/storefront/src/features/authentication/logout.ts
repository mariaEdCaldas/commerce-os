'use server';

import {getLocale} from 'next-intl/server';
import {redirect} from '@/platform/i18n/navigation';
import {getAuthToken, removeAuthToken} from '@/platform/vendure/auth-token';
import {mutate, VendureGraphQLError, VendureHttpError} from '@/platform/vendure/api';
import {LogoutMutation} from './graphql';

const LOGOUT_TIMEOUT_MS = 5_000;

type LogoutResult =
    | {outcome: 'confirmed' | 'no-session'}
    | {outcome: 'rejected' | 'graphql-error' | 'timeout' | 'network-error' | 'unexpected-error'}
    | {outcome: 'http-error'; status: number};

/**
 * Asks Vendure to end the session behind `token`. Never throws: every failure is
 * reported as an outcome so the caller can always sign the browser out.
 */
async function endVendureSession(token: string): Promise<LogoutResult> {
    try {
        const result = await mutate(LogoutMutation, {}, {
            token,
            fetch: {signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS)},
        });
        // Vendure only reports `false` when it received no session token at all.
        return {outcome: result.data.logout.success ? 'confirmed' : 'rejected'};
    } catch (error) {
        if (error instanceof VendureHttpError) return {outcome: 'http-error', status: error.status};
        if (error instanceof VendureGraphQLError) return {outcome: 'graphql-error'};
        const name = error instanceof Error ? error.name : undefined;
        if (name === 'TimeoutError') return {outcome: 'timeout'};
        if (name === 'TypeError') return {outcome: 'network-error'};
        return {outcome: 'unexpected-error'};
    }
}

export async function logoutAction() {
    const token = await getAuthToken();
    let result: LogoutResult = {outcome: 'no-session'};

    try {
        if (token) {
            result = await endVendureSession(token);
        }
    } finally {
        // The browser is always signed out, even when Vendure could not be reached.
        await removeAuthToken();
    }

    // Only the outcome is logged: never the token, cookies or customer data.
    if (result.outcome === 'confirmed' || result.outcome === 'no-session') {
        console.info('[logout]', result);
    } else {
        console.error('[logout] Vendure session may still be active', result);
    }

    const locale = await getLocale();
    redirect({href: '/', locale});
}
