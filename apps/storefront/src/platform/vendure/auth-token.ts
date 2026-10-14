import {cookies} from 'next/headers';

const AUTH_TOKEN_COOKIE = process.env.VENDURE_AUTH_TOKEN_COOKIE || 'vendure-auth-token';

// How long the browser keeps a guest (anonymous) session, and with it the guest cart.
// Vendure remains the authority on whether a token is valid: an expired or revoked
// session is rejected server-side however long the cookie lives.
const GUEST_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * The kind of Vendure session a token belongs to. Guest tokens persist so the cart
 * survives a browser restart; customer tokens are browser-session cookies.
 */
export type AuthTokenSession = 'guest' | 'customer';

function getAuthTokenCookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax' as const,
        // Browsers drop Secure cookies on plain HTTP (localhost excepted), so the
        // flag is reserved for production builds, which must be served over HTTPS.
        secure: process.env.NODE_ENV === 'production',
        path: '/',
    };
}

export async function setAuthToken(token: string, session: AuthTokenSession) {
    const cookieStore = await cookies();
    cookieStore.set(AUTH_TOKEN_COOKIE, token, {
        ...getAuthTokenCookieOptions(),
        ...(session === 'guest' && {maxAge: GUEST_TOKEN_MAX_AGE_SECONDS}),
    });
}

export async function getAuthToken(): Promise<string | undefined> {
    const cookieStore = await cookies();
    return cookieStore.get(AUTH_TOKEN_COOKIE)?.value;
}

export async function removeAuthToken() {
    const cookieStore = await cookies();
    cookieStore.delete({name: AUTH_TOKEN_COOKIE, ...getAuthTokenCookieOptions()});
}
