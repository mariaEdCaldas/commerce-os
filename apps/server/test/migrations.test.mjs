import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {hasBaselineSchema} from '../src/migration-baseline.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'src', 'migrations');

function queryRunnerWith(existingTables) {
    return {hasTable: async table => existingTables.includes(table)};
}

test('a new database gets the baseline schema created', async () => {
    assert.equal(await hasBaselineSchema(queryRunnerWith([]), ['channel', 'product']), false);
});

test('a database the scaffold already set up is only recorded', async () => {
    assert.equal(await hasBaselineSchema(queryRunnerWith(['channel', 'product', 'other']), ['channel', 'product']), true);
});

test('a partial schema stops the migration and names what is missing', async () => {
    await assert.rejects(hasBaselineSchema(queryRunnerWith(['channel']), ['channel', 'product', 'job_record']), {
        message: /missing tables: product, job_record\./,
    });
});

test('the initial migration guards every table it creates', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter(file => file.endsWith('.ts'));
    const initial = files.find(file => file.endsWith('-InitialSchema.ts'));
    assert.ok(initial, 'src/migrations must contain the InitialSchema migration');
    assert.equal(files.sort()[0], initial, 'InitialSchema must run before every other migration');

    const source = await readFile(path.join(MIGRATIONS_DIR, initial), 'utf8');
    const created = [...source.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1]);
    const listed = [...source.match(/const BASELINE_TABLES = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    assert.ok(created.length > 0);
    assert.deepEqual(listed, created);

    const up = source.slice(source.indexOf('public async up('));
    assert.ok(
        up.indexOf('hasBaselineSchema(queryRunner, BASELINE_TABLES)') < up.indexOf('await queryRunner.query('),
        'the baseline check must run before any statement',
    );
});

test('the migrations directory holds only migration files', async () => {
    // TypeORM loads every export of these files as a migration class.
    for (const file of await readdir(MIGRATIONS_DIR)) {
        assert.match(file, /^\d{13}-[A-Za-z][\w-]*\.ts$/);
        const source = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
        assert.equal([...source.matchAll(/^export /gm)].length, 1, `${file} must export only its migration class`);
    }
});
