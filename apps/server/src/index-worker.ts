import { bootstrapWorker } from '@vendure/core';
import { assertSecureProductionConfig } from './production-config';
import { config } from './vendure-config';

// Runs after vendure-config has loaded .env, and before anything touches the database.
assertSecureProductionConfig(process.env);

bootstrapWorker(config)
    .then(worker => worker.startJobQueue())
    .catch(err => {
        console.log(err);
    });
