export interface StartupSteps {
    runMigrations: () => Promise<unknown>;
    bootstrap: () => Promise<unknown>;
}

/**
 * Runs the pending migrations and starts the server only when all of them succeeded.
 *
 * Outside the Vendure CLI, `runMigrations()` does not reject when a migration fails: it logs the
 * error, sets `process.exitCode = 1`, closes its connection and resolves. That exit code is
 * therefore the failure signal. Nothing here calls `process.exit()`: the process ends with the
 * exit code once the open handles, already released by `runMigrations()`, are gone.
 *
 * Errors are logged by their stack only, never as objects, whose properties could carry
 * connection options.
 */
export async function migrateThenBootstrap(
    steps: StartupSteps,
    proc: { exitCode?: number | string | null } = process,
): Promise<void> {
    try {
        await steps.runMigrations();
    } catch (error) {
        proc.exitCode = 1;
        logError('Could not run the database migrations, so the server was not started.', error);
        return;
    }
    if (proc.exitCode) {
        logError('A database migration failed (see the error above), so the server was not started.');
        return;
    }
    try {
        await steps.bootstrap();
    } catch (error) {
        proc.exitCode = 1;
        logError('The server failed to start.', error);
    }
}

function logError(message: string, error?: unknown) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : error === undefined ? '' : String(error);
    console.error(detail ? `${message}\n${detail}` : message);
}
