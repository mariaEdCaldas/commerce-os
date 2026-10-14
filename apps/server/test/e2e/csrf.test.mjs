/**
 * Runs against a live server, so it is skipped unless E2E_SERVER_URL is set. The database must
 * hold sellable products and the scaffold's shipping and payment methods, and the customer
 * created here is left behind, so use a disposable database (see "End-to-end tests" in README.md):
 *
 *   E2E_SERVER_URL=http://localhost:3002 E2E_ADMIN_USERNAME=... E2E_ADMIN_PASSWORD=... npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const SERVER_URL = process.env.E2E_SERVER_URL;
const skip = SERVER_URL ? false : 'set E2E_SERVER_URL to run the end-to-end tests';
const SHOP_API = `${SERVER_URL}/shop-api`;
const ADMIN_API = `${SERVER_URL}/admin-api`;
const CHANNEL_TOKEN = process.env.E2E_CHANNEL_TOKEN || '__default_channel__';
const AUTH_TOKEN_HEADER = 'vendure-auth-token';
const CSRF_BLOCKED = /Cross-Site Request Forgery/;

const customer = {
    emailAddress: `csrf-e2e-${Date.now()}@example.com`,
    password: `e2e-${crypto.randomUUID()}`,
};

/** Sends a request the way the storefront's platform/vendure/api.ts does: a JSON POST. */
async function storefrontRequest(query, variables = {}, {token, api = SHOP_API} = {}) {
    const response = await fetch(api, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'vendure-token': CHANNEL_TOKEN,
            ...(token ? {Authorization: `Bearer ${token}`} : {}),
        },
        body: JSON.stringify({query, variables}),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.errors, undefined, JSON.stringify(body.errors));
    return {data: body.data, token: response.headers.get(AUTH_TOKEN_HEADER) ?? token};
}

const loginMutation = `mutation Login($username: String!, $password: String!) {
    login(username: $username, password: $password) {
        __typename
        ... on CurrentUser { identifier }
        ... on ErrorResult { message }
    }
}`;

async function assertBlocked(response) {
    const body = await response.text();
    assert.equal(response.status, 400, body);
    assert.match(body, CSRF_BLOCKED);
    assert.equal(response.headers.get(AUTH_TOKEN_HEADER), null, 'a blocked request must not create a session');
    assert.equal(response.headers.get('set-cookie'), null, 'a blocked request must not set a cookie');
}

function multipartQuery(query) {
    const form = new FormData();
    form.append('operations', JSON.stringify({query, variables: {}}));
    form.append('map', '{}');
    return form;
}

test.before(async () => {
    if (skip) return;
    const admin = await storefrontRequest(loginMutation, {
        username: process.env.E2E_ADMIN_USERNAME,
        password: process.env.E2E_ADMIN_PASSWORD,
    }, {api: ADMIN_API});
    assert.equal(admin.data.login.__typename, 'CurrentUser', 'E2E_ADMIN_USERNAME/E2E_ADMIN_PASSWORD must be valid');
    // Created with a password through the Admin API, the customer is verified and can log in.
    const created = await storefrontRequest(`mutation ($input: CreateCustomerInput!, $password: String!) {
        createCustomer(input: $input, password: $password) { __typename }
    }`, {input: {emailAddress: customer.emailAddress, firstName: 'Csrf', lastName: 'Test'}, password: customer.password},
    {api: ADMIN_API, token: admin.token});
    assert.equal(created.data.createCustomer.__typename, 'Customer');
});

// --- Requests a cross-site page can send without a CORS preflight ---------------------

test('a cross-site form cannot log a browser in (login CSRF)', {skip}, async () => {
    await assertBlocked(await fetch(SHOP_API, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({
            query: `mutation { login(username: "${customer.emailAddress}", password: "${customer.password}") { __typename } }`,
        }),
    }));
});

test('a text/plain POST is blocked', {skip}, async () => {
    await assertBlocked(await fetch(SHOP_API, {
        method: 'POST',
        headers: {'Content-Type': 'text/plain'},
        body: JSON.stringify({query: '{ activeChannel { code } }'}),
    }));
});

test('a GET query without a preflight header is blocked', {skip}, async () => {
    await assertBlocked(await fetch(`${SHOP_API}?query=${encodeURIComponent('{ activeChannel { code } }')}`));
});

test('a multipart request without a preflight header is blocked', {skip}, async () => {
    await assertBlocked(await fetch(ADMIN_API, {method: 'POST', body: multipartQuery('{ activeChannel { code } }')}));
});

// --- Clients that are allowed --------------------------------------------------------

test('GET and multipart requests with Apollo-Require-Preflight are allowed, as the Dashboard sends them', {skip}, async () => {
    const headers = {'Apollo-Require-Preflight': 'true'};
    const get = await fetch(`${SHOP_API}?query=${encodeURIComponent('{ activeChannel { code } }')}`, {headers});
    assert.equal(get.status, 200);
    assert.equal((await get.json()).data.activeChannel.code, '__default_channel__');

    const upload = await fetch(ADMIN_API, {method: 'POST', headers, body: multipartQuery('{ activeChannel { code } }')});
    const uploadBody = await upload.json();
    assert.equal(upload.status, 200, JSON.stringify(uploadBody));
    assert.doesNotMatch(JSON.stringify(uploadBody), CSRF_BLOCKED);
});

test('the storefront flow works: guest cart, login, checkout and logout', {skip}, async () => {
    const products = await storefrontRequest(`{
        search(input: { take: 20, groupByProduct: false, inStock: true }) { items { productVariantId } }
    }`);
    const variantId = products.data.search.items[0]?.productVariantId;
    assert.ok(variantId, 'the database must contain a product variant in stock');

    // Guest cart: Vendure starts an anonymous session and returns its token.
    const cart = await storefrontRequest(`mutation ($id: ID!) {
        addItemToOrder(productVariantId: $id, quantity: 1) { __typename ... on Order { code } }
    }`, {id: variantId});
    assert.equal(cart.data.addItemToOrder.__typename, 'Order');
    assert.ok(cart.token, 'adding to cart must return a session token');

    // Login sends the guest token, so the cart is kept.
    const login = await storefrontRequest(loginMutation,
        {username: customer.emailAddress, password: customer.password}, {token: cart.token});
    assert.equal(login.data.login.__typename, 'CurrentUser', JSON.stringify(login.data));
    const token = login.token;

    const active = await storefrontRequest('{ activeOrder { code lines { id } } }', {}, {token});
    assert.equal(active.data.activeOrder.code, cart.data.addItemToOrder.code);

    const address = await storefrontRequest(`mutation ($input: CreateAddressInput!) {
        setOrderShippingAddress(input: $input) { __typename }
    }`, {input: {fullName: 'Csrf Test', streetLine1: '1 Main St', city: 'Springfield', postalCode: '12345', countryCode: 'US'}}, {token});
    assert.equal(address.data.setOrderShippingAddress.__typename, 'Order');

    const shipping = await storefrontRequest('{ eligibleShippingMethods { id } }', {}, {token});
    const shippingSet = await storefrontRequest(`mutation ($ids: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $ids) { __typename }
    }`, {ids: [shipping.data.eligibleShippingMethods[0].id]}, {token});
    assert.equal(shippingSet.data.setOrderShippingMethod.__typename, 'Order');

    const transition = await storefrontRequest(`mutation {
        transitionOrderToState(state: "ArrangingPayment") { __typename ... on Order { state } }
    }`, {}, {token});
    assert.equal(transition.data.transitionOrderToState.state, 'ArrangingPayment');

    const payment = await storefrontRequest(`mutation ($input: PaymentInput!) {
        addPaymentToOrder(input: $input) { __typename ... on Order { state } ... on ErrorResult { message } }
    }`, {input: {method: 'standard-payment', metadata: {}}}, {token});
    assert.equal(payment.data.addPaymentToOrder.__typename, 'Order', JSON.stringify(payment.data));
    assert.match(payment.data.addPaymentToOrder.state, /^Payment(Settled|Authorized)$/);

    const logout = await storefrontRequest('mutation { logout { success } }', {}, {token});
    assert.equal(logout.data.logout.success, true);
    const afterLogout = await storefrontRequest('{ activeCustomer { id } }', {}, {token});
    assert.equal(afterLogout.data.activeCustomer, null, 'the session must end on logout');
});
