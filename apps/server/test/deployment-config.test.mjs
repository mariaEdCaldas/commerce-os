import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getAssetUrlPrefix,
    getEmailFromAddress,
    getSmtpTransport,
    getStorefrontEmailUrls,
    getStorefrontUrl,
} from '../src/deployment-config.ts';

test('the storefront URL defaults to the local storefront only in development', () => {
    assert.equal(getStorefrontUrl({APP_ENV: 'dev'}), 'http://localhost:3003');
    assert.equal(getStorefrontUrl({APP_ENV: 'prod'}), '');
    assert.equal(getStorefrontUrl({APP_ENV: 'dev', STOREFRONT_URL: 'http://localhost:4000'}), 'http://localhost:4000');
});

test('account email links are built from STOREFRONT_URL without double slashes', () => {
    assert.deepEqual(getStorefrontEmailUrls({APP_ENV: 'prod', STOREFRONT_URL: ' https://shop.example.com/ '}), {
        verifyEmailAddressUrl: 'https://shop.example.com/verify',
        passwordResetUrl: 'https://shop.example.com/reset-password',
        changeEmailAddressUrl: 'https://shop.example.com/account/verify-email',
    });
    assert.equal(
        getStorefrontEmailUrls({APP_ENV: 'prod', STOREFRONT_URL: 'https://example.com/shop//'}).passwordResetUrl,
        'https://example.com/shop/reset-password',
    );
});

test('the asset URL prefix is left to Vendure unless configured, and always ends in a slash', () => {
    assert.equal(getAssetUrlPrefix({}), undefined);
    assert.equal(getAssetUrlPrefix({ASSET_URL_PREFIX: ' '}), undefined);
    assert.equal(getAssetUrlPrefix({ASSET_URL_PREFIX: 'https://cdn.example.com/assets'}), 'https://cdn.example.com/assets/');
    assert.equal(getAssetUrlPrefix({ASSET_URL_PREFIX: 'https://cdn.example.com/assets/'}), 'https://cdn.example.com/assets/');
});

test('the sender address falls back to an example only when EMAIL_FROM is unset', () => {
    assert.equal(getEmailFromAddress({}), '"example" <noreply@example.com>');
    assert.equal(getEmailFromAddress({EMAIL_FROM: 'Shop <shop@example.org>'}), 'Shop <shop@example.org>');
});

test('emails stay in dev mode without SMTP_HOST', () => {
    assert.equal(getSmtpTransport({}), undefined);
    assert.equal(getSmtpTransport({SMTP_HOST: '  '}), undefined);
});

test('the SMTP transport uses the configured server and credentials', () => {
    assert.deepEqual(getSmtpTransport({SMTP_HOST: 'smtp.example.com'}), {
        type: 'smtp',
        host: 'smtp.example.com',
        port: 587,
        secure: false,
    });
    assert.deepEqual(
        getSmtpTransport({
            SMTP_HOST: 'smtp.example.com',
            SMTP_PORT: '465',
            SMTP_SECURE: 'true',
            SMTP_USER: 'mailer',
            SMTP_PASSWORD: 'secret',
        }),
        {
            type: 'smtp',
            host: 'smtp.example.com',
            port: 465,
            secure: true,
            auth: {user: 'mailer', pass: 'secret'},
        },
    );
});
