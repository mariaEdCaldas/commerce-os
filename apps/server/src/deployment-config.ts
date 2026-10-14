import type { SMTPTransportOptions } from '@vendure/email-plugin';

// The storefront created alongside this server runs on this origin in development.
const DEV_STOREFRONT_URL = 'http://localhost:3003';
const DEV_EMAIL_FROM = '"example" <noreply@example.com>';
const DEFAULT_SMTP_PORT = 587;

/**
 * The public base URL of the storefront, without a trailing slash. Falls back to the local
 * storefront in development; outside development it is empty unless STOREFRONT_URL is set.
 */
export function getStorefrontUrl(env: NodeJS.ProcessEnv): string {
    const url = env.STOREFRONT_URL?.trim() || (env.APP_ENV === 'dev' ? DEV_STOREFRONT_URL : '');
    return url.replace(/\/+$/, '');
}

/** The storefront pages that the account emails link to. */
export function getStorefrontEmailUrls(env: NodeJS.ProcessEnv) {
    const storefrontUrl = getStorefrontUrl(env);
    return {
        verifyEmailAddressUrl: `${storefrontUrl}/verify`,
        passwordResetUrl: `${storefrontUrl}/reset-password`,
        changeEmailAddressUrl: `${storefrontUrl}/account/verify-email`,
    };
}

/**
 * The public URL prefix of uploaded assets, with a trailing slash. Undefined when
 * ASSET_URL_PREFIX is unset, which lets Vendure derive it from each request.
 */
export function getAssetUrlPrefix(env: NodeJS.ProcessEnv): string | undefined {
    const prefix = env.ASSET_URL_PREFIX?.trim();
    return prefix ? prefix.replace(/\/*$/, '/') : undefined;
}

export function getEmailFromAddress(env: NodeJS.ProcessEnv): string {
    return env.EMAIL_FROM?.trim() || DEV_EMAIL_FROM;
}

/**
 * SMTP transport options when SMTP_HOST is set. Undefined otherwise, in which case the
 * EmailPlugin runs in dev mode and writes emails to files instead of sending them.
 */
export function getSmtpTransport(env: NodeJS.ProcessEnv): SMTPTransportOptions | undefined {
    const host = env.SMTP_HOST?.trim();
    if (!host) {
        return undefined;
    }
    const user = env.SMTP_USER?.trim();
    return {
        type: 'smtp',
        host,
        port: env.SMTP_PORT ? +env.SMTP_PORT : DEFAULT_SMTP_PORT,
        secure: env.SMTP_SECURE === 'true',
        ...(user ? { auth: { user, pass: env.SMTP_PASSWORD } } : {}),
    };
}
