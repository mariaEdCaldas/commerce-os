#!/usr/bin/env node
/**
 * Seeds the minimum the end-to-end tests need into an empty database, through the Admin API of a
 * running server: a country and zone, a tax rate, a shipping method, the `standard-payment`
 * method, and one product variant in stock. It then waits until the Shop API search lists the
 * variant, which needs the worker running to update the search index.
 *
 * Meant for the throwaway database in CI; on a database that already has this data it fails on
 * the first duplicate.
 *
 *   E2E_SERVER_URL=http://localhost:3002 E2E_ADMIN_USERNAME=... E2E_ADMIN_PASSWORD=... \
 *     node test/e2e/seed-catalog.mjs
 */
const SERVER_URL = required('E2E_SERVER_URL');
const ADMIN_API = `${SERVER_URL}/admin-api`;
const SHOP_API = `${SERVER_URL}/shop-api`;
const CHANNEL_TOKEN = process.env.E2E_CHANNEL_TOKEN || '__default_channel__';
const SEARCH_TIMEOUT_MS = 60_000;
const PRODUCT_SKU = 'E2E-TEST-1';

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} must be set.`);
    return value;
}

let adminToken;

async function request(api, query, variables = {}) {
    const response = await fetch(api, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'vendure-token': CHANNEL_TOKEN,
            ...(adminToken && api === ADMIN_API ? {Authorization: `Bearer ${adminToken}`} : {}),
        },
        body: JSON.stringify({query, variables}),
    });
    const body = await response.json();
    if (response.status !== 200 || body.errors) {
        throw new Error(`${query.trim().split('\n')[0]} failed (${response.status}): ${JSON.stringify(body.errors ?? body)}`);
    }
    return {data: body.data, token: response.headers.get('vendure-auth-token')};
}

/** Runs an Admin API mutation and returns its single result field, failing on an ErrorResult. */
async function admin(query, variables) {
    const {data} = await request(ADMIN_API, query, variables);
    const result = Object.values(data)[0];
    const results = Array.isArray(result) ? result : [result];
    for (const item of results) {
        if (item?.errorCode) throw new Error(`${query.trim().split('\n')[0]}: ${item.message}`);
    }
    return result;
}

const en = 'en';

const login = await request(ADMIN_API, `mutation ($username: String!, $password: String!) {
    login(username: $username, password: $password) { __typename ... on ErrorResult { message } }
}`, {username: required('E2E_ADMIN_USERNAME'), password: required('E2E_ADMIN_PASSWORD')});
if (login.data.login.__typename !== 'CurrentUser') {
    throw new Error(`Admin login failed: ${login.data.login.message}`);
}
adminToken = login.token;

const country = await admin(`mutation ($input: CreateCountryInput!) { createCountry(input: $input) { id } }`, {
    input: {code: 'US', enabled: true, translations: [{languageCode: en, name: 'United States'}]},
});
const zone = await admin(`mutation ($input: CreateZoneInput!) { createZone(input: $input) { id } }`, {
    input: {name: 'E2E Zone', memberIds: [country.id]},
});
const channel = (await request(ADMIN_API, '{ activeChannel { id } }')).data.activeChannel;
await admin(`mutation ($input: UpdateChannelInput!) {
    updateChannel(input: $input) { __typename ... on ErrorResult { errorCode message } }
}`, {input: {id: channel.id, defaultTaxZoneId: zone.id, defaultShippingZoneId: zone.id}});

const taxCategory = await admin(`mutation ($input: CreateTaxCategoryInput!) { createTaxCategory(input: $input) { id } }`, {
    input: {name: 'E2E Standard', isDefault: true},
});
await admin(`mutation ($input: CreateTaxRateInput!) { createTaxRate(input: $input) { id } }`, {
    input: {name: 'E2E Standard Rate', enabled: true, value: 10, categoryId: taxCategory.id, zoneId: zone.id},
});

await admin(`mutation ($input: CreateShippingMethodInput!) { createShippingMethod(input: $input) { id } }`, {
    input: {
        code: 'e2e-shipping',
        fulfillmentHandler: 'manual-fulfillment',
        checker: {code: 'default-shipping-eligibility-checker', arguments: [{name: 'orderMinimum', value: '0'}]},
        calculator: {
            code: 'default-shipping-calculator',
            arguments: [
                {name: 'rate', value: '500'},
                {name: 'includesTax', value: 'auto'},
                {name: 'taxRate', value: '0'},
            ],
        },
        translations: [{languageCode: en, name: 'E2E Shipping', description: ''}],
    },
});
await admin(`mutation ($input: CreatePaymentMethodInput!) { createPaymentMethod(input: $input) { id } }`, {
    input: {
        code: 'standard-payment',
        enabled: true,
        handler: {code: 'dummy-payment-handler', arguments: [{name: 'automaticSettle', value: 'true'}]},
        translations: [{languageCode: en, name: 'Standard Payment', description: ''}],
    },
});

const product = await admin(`mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`, {
    input: {enabled: true, translations: [{languageCode: en, name: 'E2E Product', slug: 'e2e-product', description: ''}]},
});
await admin(`mutation ($input: [CreateProductVariantInput!]!) { createProductVariants(input: $input) { id } }`, {
    input: [{
        productId: product.id,
        sku: PRODUCT_SKU,
        price: 1000,
        stockOnHand: 100,
        taxCategoryId: taxCategory.id,
        translations: [{languageCode: en, name: 'E2E Product'}],
    }],
});

// The search index is updated by the worker through the job queue.
const deadline = Date.now() + SEARCH_TIMEOUT_MS;
for (;;) {
    const {data} = await request(SHOP_API, `{
        search(input: { term: "${PRODUCT_SKU}", groupByProduct: false, inStock: true }) { items { sku } }
    }`);
    if (data.search.items.some(item => item.sku === PRODUCT_SKU)) break;
    if (Date.now() > deadline) {
        throw new Error(`The Shop API search did not list ${PRODUCT_SKU} within ${SEARCH_TIMEOUT_MS / 1000}s. Is the worker running?`);
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
}

console.log('Seeded the end-to-end catalogue.');
