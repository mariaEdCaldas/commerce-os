import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourceRoot = path.join(import.meta.dirname, '..', '..', 'src');
const AUTH_TOKEN_COOKIE = 'vendure-auth-token';
const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;
const SHOP_API_URL = 'http://vendure.test/shop-api';

globalThis.__sessionTestMocks ??= {};
let loadCount = 0;

function resolveSource(specifier, importer) {
    if (specifier.startsWith('@/')) return path.join(sourceRoot, `${specifier.slice(2)}.ts`);
    if (specifier.startsWith('.')) return path.resolve(path.dirname(importer), `${specifier}.ts`);
    return null;
}

/**
 * Imports a storefront TypeScript module with its imports replaced: specifiers in
 * `mocks` resolve to the given objects, specifiers in `real` (written as `@/...`)
 * are loaded from source the same way, whichever form the importer uses. Any other
 * import fails, so each test states its full dependency set.
 */
async function loadModule(file, options, loaded = new Map()) {
    if (loaded.has(file)) return loaded.get(file);
    const {mocks = {}, real = []} = options;
    const realFiles = new Set(real.map(specifier => resolveSource(specifier)));
    const source = await readFile(file, 'utf8');
    const {outputText} = ts.transpileModule(source, {
        fileName: file,
        compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
    });

    const urls = new Map();
    for (const [, imported] of outputText.matchAll(/from\s+["']([^"']+)["']/g)) {
        if (urls.has(imported)) continue;
        const resolved = resolveSource(imported, file);
        if (resolved && realFiles.has(resolved)) {
            urls.set(imported, await loadModule(resolved, options, loaded));
        } else if (imported in mocks) {
            const key = `${imported}#${loadCount++}`;
            globalThis.__sessionTestMocks[key] = mocks[imported];
            const names = Object.keys(mocks[imported]).join(', ');
            urls.set(imported, toDataUrl(
                `export const {${names}} = globalThis.__sessionTestMocks[${JSON.stringify(key)}];`,
            ));
        } else {
            throw new Error(`${path.relative(sourceRoot, file)} imports unmocked module ${imported}`);
        }
    }

    const rewritten = outputText.replace(
        /from\s+["']([^"']+)["']/g,
        (_, imported) => `from ${JSON.stringify(urls.get(imported))}`,
    );
    const url = toDataUrl(`${rewritten}\n// load ${loadCount++}`);
    loaded.set(file, url);
    return url;
}

function toDataUrl(code) {
    return `data:text/javascript,${encodeURIComponent(code)}`;
}

async function importModule(specifier, options) {
    return import(await loadModule(resolveSource(specifier), options));
}

function createCookieStore(initial = {}) {
    const values = new Map(Object.entries(initial));
    const calls = {set: [], delete: []};
    const store = {
        get: (name) => (values.has(name) ? {name, value: values.get(name)} : undefined),
        set: (name, value, options) => {
            calls.set.push({name, value, options});
            values.set(name, value);
        },
        delete: (options) => {
            calls.delete.push(options);
            values.delete(typeof options === 'string' ? options : options.name);
        },
    };
    return {store, calls, values};
}

function withEnv(t, name, value) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
    });
}

function headersMock(cookieStore) {
    return {'next/headers': {cookies: async () => cookieStore.store}};
}

// --- Cookie policy -----------------------------------------------------------------

async function loadAuthToken(cookieStore) {
    return importModule('@/platform/vendure/auth-token', {mocks: headersMock(cookieStore)});
}

test('a guest token cookie is HttpOnly, SameSite=Lax, site-wide and persists for 30 days', async (t) => {
    withEnv(t, 'NODE_ENV', 'development');
    const cookieStore = createCookieStore();
    const {setAuthToken} = await loadAuthToken(cookieStore);

    await setAuthToken('guest-token', 'guest');

    assert.deepEqual(cookieStore.calls.set, [{
        name: AUTH_TOKEN_COOKIE,
        value: 'guest-token',
        options: {httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: THIRTY_DAYS_IN_SECONDS},
    }]);
});

test('a customer token cookie is a browser-session cookie with the same security flags', async (t) => {
    withEnv(t, 'NODE_ENV', 'development');
    const cookieStore = createCookieStore();
    const {setAuthToken} = await loadAuthToken(cookieStore);

    await setAuthToken('customer-token', 'customer');

    assert.deepEqual(cookieStore.calls.set, [{
        name: AUTH_TOKEN_COOKIE,
        value: 'customer-token',
        options: {httpOnly: true, sameSite: 'lax', secure: false, path: '/'},
    }]);
});

test('token cookies are Secure in production builds', async (t) => {
    withEnv(t, 'NODE_ENV', 'production');
    const cookieStore = createCookieStore();
    const {setAuthToken} = await loadAuthToken(cookieStore);

    await setAuthToken('guest-token', 'guest');
    await setAuthToken('customer-token', 'customer');

    assert.deepEqual(cookieStore.calls.set.map(call => call.options.secure), [true, true]);
});

test('removing the token deletes the cookie with the attributes it was set with', async (t) => {
    withEnv(t, 'NODE_ENV', 'production');
    const cookieStore = createCookieStore({[AUTH_TOKEN_COOKIE]: 'customer-token'});
    const {removeAuthToken} = await loadAuthToken(cookieStore);

    await removeAuthToken();

    assert.deepEqual(cookieStore.calls.delete, [{
        name: AUTH_TOKEN_COOKIE, httpOnly: true, sameSite: 'lax', secure: true, path: '/',
    }]);
    assert.equal(cookieStore.values.has(AUTH_TOKEN_COOKIE), false);
});

// --- Vendure API errors ----------------------------------------------------------

async function loadApi(t, cookieStore = createCookieStore()) {
    withEnv(t, 'VENDURE_SHOP_API_URL', SHOP_API_URL);
    return importModule('@/platform/vendure/api', {
        real: ['@/platform/vendure/auth-token'],
        mocks: {...headersMock(cookieStore), graphql: {print: () => 'mutation Logout { logout { success } }'}},
    });
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

test('API failures raise typed errors that keep their previous messages', async (t) => {
    const api = await loadApi(t);

    t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', {status: 503}));
    await assert.rejects(api.query('document'), (error) =>
        error instanceof api.VendureHttpError && error.status === 503 && error.message === 'HTTP error! status: 503');

    globalThis.fetch.mock.mockImplementation(async () => jsonResponse({errors: [{message: 'a'}, {message: 'b'}]}));
    await assert.rejects(api.query('document'), (error) =>
        error instanceof api.VendureGraphQLError && error instanceof Error && error.message === 'a, b');
});

test('API requests are JSON POSTs, which Vendure accepts with csrfPrevention enabled', async (t) => {
    // Vendure blocks GET, form, multipart and text/plain requests that lack an
    // Apollo-Require-Preflight header; the storefront relies on never sending one of those.
    const api = await loadApi(t);
    const fetch = t.mock.method(globalThis, 'fetch', async () => jsonResponse({data: {logout: {success: true}}}));

    await api.query('document', {}, {token: 'session-token', fetch: {signal: AbortSignal.timeout(1_000)}});
    await api.mutate('document', {}, {languageCode: 'de'});

    assert.equal(fetch.mock.callCount(), 2);
    for (const call of fetch.mock.calls) {
        const [, init] = call.arguments;
        assert.equal(init.method, 'POST');
        assert.equal(init.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(init.body), {query: 'mutation Logout { logout { success } }', variables: {}});
    }
});

// --- Logout ------------------------------------------------------------------------

async function loadLogout(t, cookieStore) {
    withEnv(t, 'VENDURE_SHOP_API_URL', SHOP_API_URL);
    const redirects = [];
    const logs = {
        info: t.mock.method(console, 'info', () => {}),
        error: t.mock.method(console, 'error', () => {}),
    };
    const timeouts = [];
    t.mock.method(AbortSignal, 'timeout', (ms) => {
        timeouts.push(ms);
        return new AbortController().signal;
    });
    const {logoutAction} = await importModule('@/features/authentication/logout', {
        real: ['@/platform/vendure/auth-token', '@/platform/vendure/api'],
        mocks: {
            ...headersMock(cookieStore),
            graphql: {print: () => 'mutation Logout { logout { success } }'},
            'next-intl/server': {getLocale: async () => 'en'},
            '@/platform/i18n/navigation': {redirect: (target) => redirects.push(target)},
            './graphql': {LogoutMutation: 'LogoutMutation'},
        },
    });
    return {logoutAction, redirects, logs, timeouts};
}

function loggedOutcomes(logs) {
    return [...logs.info.mock.calls, ...logs.error.mock.calls].map(call => call.arguments.at(-1));
}

function assertSignedOutLocally(cookieStore, redirects) {
    assert.equal(cookieStore.values.has(AUTH_TOKEN_COOKIE), false);
    assert.equal(cookieStore.calls.delete.length, 1);
    assert.deepEqual(redirects, [{href: '/', locale: 'en'}]);
}

function assertTokenNeverLogged(logs, token) {
    const logged = JSON.stringify([...logs.info.mock.calls, ...logs.error.mock.calls].map(call => call.arguments));
    assert.equal(logged.includes(token), false);
}

test('logout sends the stored token as a Bearer token with a 5 second timeout and logs a confirmed outcome', async (t) => {
    const cookieStore = createCookieStore({[AUTH_TOKEN_COOKIE]: 'session-token'});
    const {logoutAction, redirects, logs, timeouts} = await loadLogout(t, cookieStore);
    const fetch = t.mock.method(globalThis, 'fetch', async () =>
        jsonResponse({data: {logout: {__typename: 'Success', success: true}}}));

    await logoutAction();

    assert.equal(fetch.mock.callCount(), 1);
    const [url, init] = fetch.mock.calls[0].arguments;
    assert.equal(url, SHOP_API_URL);
    assert.equal(init.headers.Authorization, 'Bearer session-token');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(timeouts, [5_000]);
    assertSignedOutLocally(cookieStore, redirects);
    assert.deepEqual(loggedOutcomes(logs), [{outcome: 'confirmed'}]);
    assert.equal(logs.error.mock.callCount(), 0);
    assertTokenNeverLogged(logs, 'session-token');
});

const failures = [
    {
        name: 'Vendure reports that no session was ended',
        fetch: async () => jsonResponse({data: {logout: {__typename: 'Success', success: false}}}),
        expected: {outcome: 'rejected'},
    },
    {
        name: 'the logout mutation returns GraphQL errors',
        fetch: async () => jsonResponse({errors: [{message: 'Forbidden'}]}),
        expected: {outcome: 'graphql-error'},
    },
    {
        name: 'the API answers with an HTTP error',
        fetch: async () => new Response('unavailable', {status: 503}),
        expected: {outcome: 'http-error', status: 503},
    },
    {
        name: 'the API cannot be reached',
        fetch: async () => {
            throw new TypeError('fetch failed');
        },
        expected: {outcome: 'network-error'},
    },
    {
        name: 'the API does not answer within the timeout',
        fetch: async () => {
            throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        },
        expected: {outcome: 'timeout'},
    },
];

for (const failure of failures) {
    test(`logout still signs the browser out and logs the outcome when ${failure.name}`, async (t) => {
        const cookieStore = createCookieStore({[AUTH_TOKEN_COOKIE]: 'session-token'});
        const {logoutAction, redirects, logs} = await loadLogout(t, cookieStore);
        t.mock.method(globalThis, 'fetch', failure.fetch);

        await logoutAction();

        assertSignedOutLocally(cookieStore, redirects);
        assert.equal(logs.error.mock.callCount(), 1);
        assert.deepEqual(loggedOutcomes(logs), [failure.expected]);
        assertTokenNeverLogged(logs, 'session-token');
    });
}

test('logout without a stored token skips the Vendure call', async (t) => {
    const cookieStore = createCookieStore();
    const {logoutAction, redirects, logs} = await loadLogout(t, cookieStore);
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('should not be called');
    });

    await logoutAction();

    assert.equal(fetch.mock.callCount(), 0);
    assertSignedOutLocally(cookieStore, redirects);
    assert.deepEqual(loggedOutcomes(logs), [{outcome: 'no-session'}]);
});

// --- Token writers ---------------------------------------------------------------

test('login sends the guest token so Vendure keeps the guest cart, then stores a customer session cookie', async (t) => {
    withEnv(t, 'NODE_ENV', 'development');
    const cookieStore = createCookieStore({[AUTH_TOKEN_COOKIE]: 'guest-token'});
    const mutateCalls = [];
    const {loginAction} = await importModule('@/features/authentication/routes/sign-in/actions', {
        real: ['@/platform/vendure/auth-token'],
        mocks: {
            ...headersMock(cookieStore),
            'next-intl/server': {getLocale: async () => 'en', getTranslations: async () => (key) => key},
            'next/cache': {revalidatePath: () => {}},
            '@/platform/i18n/navigation': {redirect: () => {}},
            '@/features/authentication/graphql': {LoginMutation: 'LoginMutation'},
            '@/platform/vendure/api': {
                mutate: async (...args) => {
                    mutateCalls.push(args);
                    return {data: {login: {__typename: 'CurrentUser'}}, token: 'customer-token'};
                },
            },
        },
    });

    const form = new FormData();
    form.set('username', 'customer@example.com');
    form.set('password', 'not-a-real-password');
    await loginAction(undefined, form);

    assert.deepEqual(mutateCalls[0][2], {useAuthToken: true});
    assert.equal(cookieStore.values.get(AUTH_TOKEN_COOKIE), 'customer-token');
    assert.equal(cookieStore.calls.set[0].options.httpOnly, true);
    assert.equal('maxAge' in cookieStore.calls.set[0].options, false);
});

test('verifying an account stores a customer session cookie', async () => {
    const cookieStore = createCookieStore();
    const {verifyAccountAction} = await importModule('@/features/authentication/routes/verify/actions', {
        real: ['@/platform/vendure/auth-token'],
        mocks: {
            ...headersMock(cookieStore),
            'next-intl/server': {getTranslations: async () => (key) => key},
            '@/features/authentication/graphql': {VerifyCustomerAccountMutation: 'VerifyCustomerAccountMutation'},
            '@/platform/vendure/api': {
                mutate: async () => ({data: {verifyCustomerAccount: {__typename: 'CurrentUser'}}, token: 'customer-token'}),
            },
        },
    });

    assert.deepEqual(await verifyAccountAction('verification-token'), {success: true});
    assert.equal(cookieStore.values.get(AUTH_TOKEN_COOKIE), 'customer-token');
    assert.equal('maxAge' in cookieStore.calls.set[0].options, false);
});

test('resetting a password stores a customer session cookie', async () => {
    const cookieStore = createCookieStore();
    const {resetPasswordAction} = await importModule('@/features/authentication/routes/reset-password/actions', {
        real: ['@/platform/vendure/auth-token'],
        mocks: {
            ...headersMock(cookieStore),
            'next-intl/server': {getLocale: async () => 'en', getTranslations: async () => (key) => key},
            '@/platform/i18n/navigation': {redirect: () => {}},
            '@/features/authentication/graphql': {ResetPasswordMutation: 'ResetPasswordMutation'},
            '@/platform/vendure/api': {
                mutate: async () => ({data: {resetPassword: {__typename: 'CurrentUser'}}, token: 'customer-token'}),
            },
        },
    });

    const form = new FormData();
    form.set('token', 'reset-token');
    form.set('password', 'not-a-real-password');
    form.set('confirmPassword', 'not-a-real-password');
    await resetPasswordAction(undefined, form);

    assert.equal(cookieStore.values.get(AUTH_TOKEN_COOKIE), 'customer-token');
    assert.equal('maxAge' in cookieStore.calls.set[0].options, false);
});

test('adding to cart as a guest stores the anonymous session token for 30 days', async (t) => {
    withEnv(t, 'NODE_ENV', 'development');
    const cookieStore = createCookieStore();
    const mutateCalls = [];
    const {addToCart} = await importModule('@/features/products/add-to-cart', {
        real: ['@/platform/vendure/auth-token'],
        mocks: {
            ...headersMock(cookieStore),
            'next-intl/server': {getLocale: async () => 'en', getTranslations: async () => (key) => key},
            'next/cache': {updateTag: () => {}},
            '@/features/cart/graphql': {AddToCartMutation: 'AddToCartMutation'},
            '@/features/currency/currency-server': {getActiveCurrencyCode: async () => 'USD'},
            '@/platform/vendure/api': {
                mutate: async (...args) => {
                    mutateCalls.push(args);
                    return {data: {addItemToOrder: {__typename: 'Order', id: '1'}}, token: 'guest-token'};
                },
            },
        },
    });

    const result = await addToCart('42', 1);

    assert.equal(result.success, true);
    assert.deepEqual(mutateCalls[0][2], {useAuthToken: true, currencyCode: 'USD'});
    assert.equal(cookieStore.values.get(AUTH_TOKEN_COOKIE), 'guest-token');
    assert.equal(cookieStore.calls.set[0].options.maxAge, THIRTY_DAYS_IN_SECONDS);
});
