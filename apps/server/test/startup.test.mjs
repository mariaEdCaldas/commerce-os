import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {migrateThenBootstrap} from '../src/startup.ts';

function startup({migrations = async () => [], bootstrap = async () => {}} = {}) {
    const proc = {exitCode: undefined};
    const calls = [];
    const steps = {
        runMigrations: async () => {
            calls.push('runMigrations');
            return migrations(proc);
        },
        bootstrap: async () => {
            calls.push('bootstrap');
            return bootstrap();
        },
    };
    return {proc, calls, run: () => migrateThenBootstrap(steps, proc)};
}

function silenceErrors(t) {
    return t.mock.method(console, 'error', () => {});
}

function loggedText(errors) {
    return errors.mock.calls.map(call => call.arguments.join(' ')).join('\n');
}

test('the server starts after the migrations succeed', async (t) => {
    const errors = silenceErrors(t);
    const {proc, calls, run} = startup();

    await run();

    assert.deepEqual(calls, ['runMigrations', 'bootstrap']);
    assert.equal(proc.exitCode, undefined);
    assert.equal(errors.mock.callCount(), 0);
});

test('a failed migration stops the start-up with a non-zero exit code', async (t) => {
    const errors = silenceErrors(t);
    // This is how Vendure's runMigrations() reports a failed migration outside the CLI.
    const {proc, calls, run} = startup({migrations: async (p) => {
        p.exitCode = 1;
        return [];
    }});

    await run();

    assert.deepEqual(calls, ['runMigrations']);
    assert.equal(proc.exitCode, 1);
    assert.match(loggedText(errors), /A database migration failed .*so the server was not started\./);
});

test('an unreachable database stops the start-up without logging error properties', async (t) => {
    const errors = silenceErrors(t);
    const failure = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6543'), {
        options: {password: 'db-secret-value'},
    });
    const {proc, calls, run} = startup({migrations: async () => {
        throw failure;
    }});

    await run();

    assert.deepEqual(calls, ['runMigrations']);
    assert.equal(proc.exitCode, 1);
    const logged = loggedText(errors);
    assert.match(logged, /Could not run the database migrations, so the server was not started\./);
    assert.match(logged, /ECONNREFUSED/);
    assert.equal(logged.includes('db-secret-value'), false);
});

test('a bootstrap failure sets a non-zero exit code', async (t) => {
    const errors = silenceErrors(t);
    const {proc, calls, run} = startup({bootstrap: async () => {
        throw new Error('port 3002 is already in use');
    }});

    await run();

    assert.deepEqual(calls, ['runMigrations', 'bootstrap']);
    assert.equal(proc.exitCode, 1);
    assert.match(loggedText(errors), /The server failed to start\.[\s\S]*port 3002/);
});

test('the server entry point bootstraps only through migrateThenBootstrap', async () => {
    const source = await readFile(path.join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
    assert.match(source, /migrateThenBootstrap\(\{\s*runMigrations: \(\) => runMigrations\(config\),\s*bootstrap: \(\) => bootstrap\(config\),\s*\}\)/);
    assert.equal(source.match(/\bbootstrap\(config\)/g).length, 1);
    assert.equal(source.includes('.then('), false, 'bootstrap must not be chained directly after runMigrations');
});

test('the Shop and Admin APIs reject requests a cross-site form could send', async () => {
    const source = await readFile(path.join(import.meta.dirname, '..', 'src', 'vendure-config.ts'), 'utf8');
    const apiOptions = source.slice(source.indexOf('apiOptions: {'), source.indexOf('authOptions: {'));
    assert.match(apiOptions, /^\s*csrfPrevention: true,$/m);
});
