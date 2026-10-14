import { bootstrap, runMigrations } from '@vendure/core';
import { assertSecureProductionConfig } from './production-config';
import { migrateThenBootstrap } from './startup';
import { config } from './vendure-config';

// Runs after vendure-config has loaded .env, and before anything touches the database.
assertSecureProductionConfig(process.env);

// A failed migration stops the start-up with a non-zero exit code instead of serving
// requests against a partially migrated schema.
void migrateThenBootstrap({
    runMigrations: () => runMigrations(config),
    bootstrap: () => bootstrap(config),
});
