import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {SUPER_ADMIN_USER_PASSWORD} from '@vendure/common/lib/shared-constants';
import {assertSecureProductionConfig, getProductionConfigProblems} from '../src/production-config.ts';

const STRONG_SECRET = 'q7Vd2kLp9XzR4mNw8sTy3bHc6fJg1aQe';
const STRONG_PASSWORD = 'x4!Gv9#pLr2@Wm7s';

function productionEnv(overrides = {}) {
    return {
        APP_ENV: 'prod',
        SUPERADMIN_USERNAME: 'store-owner',
        SUPERADMIN_PASSWORD: STRONG_PASSWORD,
        COOKIE_SECRET: STRONG_SECRET,
        CORS_ORIGINS: 'https://shop.example.com,https://admin.example.com',
        STOREFRONT_URL: 'https://shop.example.com',
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'mailer',
        SMTP_PASSWORD: 'smtp-password',
        EMAIL_FROM: '"Shop" <noreply@shop.example.com>',
        ...overrides,
    };
}

function problemsFor(overrides) {
    return getProductionConfigProblems(productionEnv(overrides));
}

test('a secure production configuration has no problems', () => {
    assert.deepEqual(getProductionConfigProblems(productionEnv()), []);
    assert.doesNotThrow(() => assertSecureProductionConfig(productionEnv()));
});

test('development (APP_ENV=dev) is not checked', () => {
    assert.deepEqual(getProductionConfigProblems({APP_ENV: 'dev', SUPERADMIN_PASSWORD: SUPER_ADMIN_USER_PASSWORD}), []);
});

test('an unset APP_ENV is treated as a deployment, like IS_DEV in vendure-config', () => {
    assert.notDeepEqual(getProductionConfigProblems(productionEnv({APP_ENV: undefined, CORS_ORIGINS: ''})), []);
});

test('the public default SuperAdmin password is refused, as is a missing one', () => {
    assert.deepEqual(problemsFor({SUPERADMIN_PASSWORD: SUPER_ADMIN_USER_PASSWORD}), [
        "SUPERADMIN_PASSWORD must not be Vendure's public default password.",
    ]);
    assert.deepEqual(problemsFor({SUPERADMIN_PASSWORD: ''}), ['SUPERADMIN_PASSWORD must be set.']);
});

test('COOKIE_SECRET must be long and not a repeated pattern', () => {
    assert.deepEqual(problemsFor({COOKIE_SECRET: undefined}), ['COOKIE_SECRET must be at least 32 characters long.']);
    assert.deepEqual(problemsFor({COOKIE_SECRET: 'short-secret'}), ['COOKIE_SECRET must be at least 32 characters long.']);
    assert.deepEqual(problemsFor({COOKIE_SECRET: 'ab'.repeat(20)}), [
        'COOKIE_SECRET must be a random value, not a repeated pattern.',
    ]);
});

test('CORS_ORIGINS must be explicitly configured', () => {
    for (const value of [undefined, '', ' , ']) {
        assert.deepEqual(problemsFor({CORS_ORIGINS: value}), [
            'CORS_ORIGINS must list the browser origins allowed to call the APIs.',
        ]);
    }
});

test('every CORS_ORIGINS entry must be an https origin without a path', () => {
    assert.deepEqual(problemsFor({CORS_ORIGINS: 'https://shop.example.com,*,https://shop.example.com/,http://shop.example.com'}), [
        'CORS_ORIGINS entry 2 is not a valid origin.',
        'CORS_ORIGINS entry 3 must be an origin only (scheme, host and optional port, no path or trailing slash).',
        'CORS_ORIGINS entry 4 must use https (plain http is only accepted for localhost).',
    ]);
    assert.deepEqual(problemsFor({CORS_ORIGINS: 'http://localhost:3003, http://127.0.0.1:3003'}), []);
});

test('STOREFRONT_URL must be a secure URL', () => {
    for (const value of [undefined, ' ']) {
        assert.deepEqual(problemsFor({STOREFRONT_URL: value}), [
            'STOREFRONT_URL must be set to the public URL that account emails link to.',
        ]);
    }
    assert.deepEqual(problemsFor({STOREFRONT_URL: 'shop.example.com'}), ['STOREFRONT_URL is not a valid URL.']);
    assert.deepEqual(problemsFor({STOREFRONT_URL: 'http://shop.example.com'}), [
        'STOREFRONT_URL must use https (plain http is only accepted for localhost).',
    ]);
    assert.deepEqual(problemsFor({STOREFRONT_URL: 'https://example.com/shop/'}), []);
    assert.deepEqual(problemsFor({STOREFRONT_URL: 'http://localhost:3003'}), []);
});

test('ASSET_URL_PREFIX is optional but must be a secure URL when set', () => {
    assert.deepEqual(problemsFor({ASSET_URL_PREFIX: ''}), []);
    assert.deepEqual(problemsFor({ASSET_URL_PREFIX: 'https://cdn.example.com/assets/'}), []);
    assert.deepEqual(problemsFor({ASSET_URL_PREFIX: 'http://cdn.example.com/assets/'}), [
        'ASSET_URL_PREFIX must use https (plain http is only accepted for localhost).',
    ]);
});

test('emails must be sent over SMTP instead of exposed on /mailbox', () => {
    assert.deepEqual(problemsFor({SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASSWORD: undefined}), [
        'SMTP_HOST must be set so that emails are sent instead of exposed on /mailbox.',
    ]);
    assert.deepEqual(problemsFor({SMTP_USER: undefined, SMTP_PASSWORD: undefined}), []);
    assert.deepEqual(problemsFor({SMTP_PASSWORD: undefined}), ['SMTP_USER and SMTP_PASSWORD must be set together.']);
    assert.deepEqual(problemsFor({SMTP_USER: ''}), ['SMTP_USER and SMTP_PASSWORD must be set together.']);
    for (const port of ['0', '65536', '587a', '-1']) {
        assert.deepEqual(problemsFor({SMTP_PORT: port}), ['SMTP_PORT must be a port number between 1 and 65535.']);
    }
    assert.deepEqual(problemsFor({SMTP_PORT: '465', SMTP_SECURE: 'true'}), []);
    assert.deepEqual(problemsFor({SMTP_SECURE: 'yes'}), ['SMTP_SECURE must be "true" or "false".']);
    assert.deepEqual(problemsFor({EMAIL_FROM: undefined}), [
        'EMAIL_FROM must be set to the sender address of outgoing emails.',
    ]);
});

test('the SMTP password never appears in the startup error', () => {
    const env = productionEnv({SMTP_USER: '', SMTP_PASSWORD: 'leaky-smtp-password'});
    assert.throws(() => assertSecureProductionConfig(env), (error) => {
        assert.match(error.message, /SMTP_PASSWORD/);
        assert.equal(error.message.includes('leaky-smtp-password'), false);
        return true;
    });
});

test('the startup error lists every problem without revealing any value', () => {
    const env = productionEnv({
        SUPERADMIN_PASSWORD: SUPER_ADMIN_USER_PASSWORD,
        COOKIE_SECRET: 'not-long-enough-secret',
        CORS_ORIGINS: '',
    });

    assert.throws(() => assertSecureProductionConfig(env), (error) => {
        assert.match(error.message, /^Refusing to start with an insecure configuration:/);
        assert.match(error.message, /SUPERADMIN_PASSWORD/);
        assert.match(error.message, /COOKIE_SECRET/);
        assert.match(error.message, /CORS_ORIGINS/);
        assert.equal(error.message.includes('not-long-enough-secret'), false);
        assert.equal(error.message.includes(SUPER_ADMIN_USER_PASSWORD), false);
        return true;
    });
});

test('the server and the worker check the configuration before bootstrapping', async () => {
    for (const entry of ['index.ts', 'index-worker.ts']) {
        const source = await readFile(path.join(import.meta.dirname, '..', 'src', entry), 'utf8');
        const check = source.indexOf('assertSecureProductionConfig(process.env);');
        const bootstrap = source.search(/\b(runMigrations|bootstrapWorker)\(config\)/);
        assert.ok(check !== -1, `${entry} must call assertSecureProductionConfig`);
        assert.ok(check < bootstrap, `${entry} must check the configuration before bootstrapping`);
    }
});
