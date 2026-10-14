import type { QueryRunner } from 'typeorm';

/**
 * Decides whether a baseline migration must create its schema or only record it as applied.
 *
 * Databases created by the `@vendure/create` scaffold already hold the baseline schema, built
 * by TypeORM's `synchronize`, but have no migration on record. Running the CREATE statements
 * there would fail, so the migration is recorded without changes instead.
 *
 * Returns false when none of the tables exist (a new database: create the schema) and true
 * when all of them do (an existing database: skip). Throws when only some exist, since that
 * schema cannot be safely completed or skipped automatically. This lives outside
 * `src/migrations` because TypeORM loads every export of the files there as a migration.
 */
export async function hasBaselineSchema(queryRunner: QueryRunner, tables: readonly string[]): Promise<boolean> {
    const missing: string[] = [];
    for (const table of tables) {
        if (!(await queryRunner.hasTable(table))) {
            missing.push(table);
        }
    }
    if (missing.length === tables.length) {
        return false;
    }
    if (missing.length > 0) {
        throw new Error(
            `The database holds part of the baseline schema; missing tables: ${missing.join(', ')}. ` +
                'Restore it from a backup or reconcile it by hand before running migrations.',
        );
    }
    return true;
}
