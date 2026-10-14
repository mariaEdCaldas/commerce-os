import { SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';

const MIN_COOKIE_SECRET_LENGTH = 32;
const MIN_COOKIE_SECRET_DISTINCT_CHARACTERS = 10;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Lists why the environment is unsafe for a deployment outside development
 * (`APP_ENV` other than `dev`, matching `IS_DEV` in vendure-config.ts).
 * Problems name the offending variables but never include their values.
 */
export function getProductionConfigProblems(env: NodeJS.ProcessEnv): string[] {
    if (env.APP_ENV === 'dev') {
        return [];
    }
    const problems: string[] = [];

    // Vendure itself only refuses the default password when NODE_ENV is 'production'.
    if (!env.SUPERADMIN_PASSWORD) {
        problems.push('SUPERADMIN_PASSWORD must be set.');
    } else if (env.SUPERADMIN_PASSWORD === SUPER_ADMIN_USER_PASSWORD) {
        problems.push("SUPERADMIN_PASSWORD must not be Vendure's public default password.");
    }

    const cookieSecret = env.COOKIE_SECRET ?? '';
    if (cookieSecret.length < MIN_COOKIE_SECRET_LENGTH) {
        problems.push(`COOKIE_SECRET must be at least ${MIN_COOKIE_SECRET_LENGTH} characters long.`);
    } else if (new Set(cookieSecret).size < MIN_COOKIE_SECRET_DISTINCT_CHARACTERS) {
        problems.push('COOKIE_SECRET must be a random value, not a repeated pattern.');
    }

    const origins = (env.CORS_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean);
    if (origins.length === 0) {
        problems.push('CORS_ORIGINS must list the browser origins allowed to call the APIs.');
    }
    origins.forEach((origin, index) => {
        const problem = getOriginProblem(origin);
        if (problem) {
            problems.push(`CORS_ORIGINS entry ${index + 1} ${problem}.`);
        }
    });

    // Password reset and verification tokens travel in these links.
    const storefrontUrl = env.STOREFRONT_URL?.trim();
    if (!storefrontUrl) {
        problems.push('STOREFRONT_URL must be set to the public URL that account emails link to.');
    } else {
        const problem = getPublicUrlProblem(storefrontUrl);
        if (problem) {
            problems.push(`STOREFRONT_URL ${problem}.`);
        }
    }

    const assetUrlPrefix = env.ASSET_URL_PREFIX?.trim();
    if (assetUrlPrefix) {
        const problem = getPublicUrlProblem(assetUrlPrefix);
        if (problem) {
            problems.push(`ASSET_URL_PREFIX ${problem}.`);
        }
    }

    // Without SMTP the EmailPlugin runs in dev mode, which publishes every email,
    // password reset links included, on the unauthenticated /mailbox route.
    if (!env.SMTP_HOST?.trim()) {
        problems.push('SMTP_HOST must be set so that emails are sent instead of exposed on /mailbox.');
    }
    if (env.SMTP_PORT && !isPort(env.SMTP_PORT)) {
        problems.push('SMTP_PORT must be a port number between 1 and 65535.');
    }
    if (env.SMTP_SECURE && env.SMTP_SECURE !== 'true' && env.SMTP_SECURE !== 'false') {
        problems.push('SMTP_SECURE must be "true" or "false".');
    }
    if (Boolean(env.SMTP_USER?.trim()) !== Boolean(env.SMTP_PASSWORD)) {
        problems.push('SMTP_USER and SMTP_PASSWORD must be set together.');
    }
    if (!env.EMAIL_FROM?.trim()) {
        problems.push('EMAIL_FROM must be set to the sender address of outgoing emails.');
    }

    return problems;
}

function isPort(value: string): boolean {
    return /^\d+$/.test(value) && +value >= 1 && +value <= 65535;
}

function getPublicUrlProblem(value: string): string | undefined {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return 'is not a valid URL';
    }
    if (!isSecureUrl(url)) {
        return 'must use https (plain http is only accepted for localhost)';
    }
}

function getOriginProblem(origin: string): string | undefined {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return 'is not a valid origin';
    }
    if (url.origin !== origin) {
        return 'must be an origin only (scheme, host and optional port, no path or trailing slash)';
    }
    if (!isSecureUrl(url)) {
        return 'must use https (plain http is only accepted for localhost)';
    }
}

function isSecureUrl(url: URL): boolean {
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname));
}

/**
 * Throws, before Vendure bootstraps, when the environment is unsafe for a
 * deployment outside development.
 */
export function assertSecureProductionConfig(env: NodeJS.ProcessEnv): void {
    const problems = getProductionConfigProblems(env);
    if (problems.length > 0) {
        throw new Error(
            'Refusing to start with an insecure configuration:\n' +
                problems.map(problem => `- ${problem}`).join('\n'),
        );
    }
}
