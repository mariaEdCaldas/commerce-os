import { bootstrapWorker } from '@vendure/core';
import { assertSecureProductionConfig } from './production-config';
import { config } from './vendure-config';

// Runs after vendure-config has loaded .env, and before anything touches the database.
assertSecureProductionConfig(process.env);

bootstrapWorker(config)
    .then(worker => worker.startJobQueue())
    .catch(err => {
        process.exitCode = 1;
        console.error('The worker failed to start.', err instanceof Error ? (err.stack ?? err.message) : String(err));
    });
