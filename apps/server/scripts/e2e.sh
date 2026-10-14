#!/usr/bin/env bash
# Runs the end-to-end tests against a server and worker started from the compiled build
# (`npm run build:server`), on an empty PostgreSQL database:
#
#   1. starts the server, whose start-up applies the migrations, and waits for the Shop API;
#   2. checks that the migrations produce exactly the schema the entities describe;
#   3. starts the worker, which updates the search index;
#   4. seeds the test catalogue and runs test/e2e;
#   5. stops both processes, printing their logs when a step failed.
#
# The server configuration (DB_*, SUPERADMIN_*, COOKIE_SECRET, ...) and E2E_SERVER_URL,
# E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD come from the environment; .github/workflows/ci.yml
# shows a complete set. Logs are written to E2E_LOG_DIR, or a temporary directory.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${E2E_SERVER_URL:?must be set, e.g. http://localhost:3002}"
: "${E2E_ADMIN_USERNAME:?must be set}"
: "${E2E_ADMIN_PASSWORD:?must be set}"
API_TIMEOUT_SECONDS=${E2E_API_TIMEOUT_SECONDS:-120}
LOG_DIR=${E2E_LOG_DIR:-$(mktemp -d)}
mkdir -p "$LOG_DIR"

server_pid=
worker_pid=

stop() {
    local pid=$1
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 0
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 0.5
    done
    echo "Process $pid did not stop after SIGTERM; sending SIGKILL." >&2
    kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
    local status=$?
    stop "$worker_pid"
    stop "$server_pid"
    if [ "$status" -ne 0 ]; then
        for log in server worker; do
            if [ -f "$LOG_DIR/$log.log" ]; then
                echo "::group::$log log (last 200 lines)"
                tail -n 200 "$LOG_DIR/$log.log"
                echo "::endgroup::"
            fi
        done
    fi
    exit "$status"
}
trap cleanup EXIT

echo "Starting the server; its start-up runs the migrations."
node dist/index.js > "$LOG_DIR/server.log" 2>&1 &
server_pid=$!

echo "Waiting up to ${API_TIMEOUT_SECONDS}s for the Shop API."
deadline=$((SECONDS + API_TIMEOUT_SECONDS))
until curl -sf -o /dev/null -X POST "$E2E_SERVER_URL/shop-api" \
    -H 'Content-Type: application/json' -d '{"query":"{ activeChannel { code } }"}'; do
    if ! kill -0 "$server_pid" 2>/dev/null; then
        wait "$server_pid" && code=0 || code=$?
        echo "The server exited with code $code before the API was ready." >&2
        exit 1
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
        echo "The Shop API was not ready within ${API_TIMEOUT_SECONDS}s." >&2
        exit 1
    fi
    sleep 2
done
grep -q 'Successfully ran migration: InitialSchema' "$LOG_DIR/server.log" || {
    echo "The server did not apply the InitialSchema migration; the database was not empty." >&2
    exit 1
}

echo "Checking that the migrations match the entities."
drift_dir=$(mktemp -d)
npx vendure migrate -g SchemaDriftCheck -o "$drift_dir" > "$LOG_DIR/drift-check.log" 2>&1
if [ -n "$(ls -A "$drift_dir")" ]; then
    echo "The entities differ from the schema the migrations create. Generate a migration with" >&2
    echo "'npm run migration:generate -- <Name>'. Missing changes:" >&2
    cat "$drift_dir"/*.ts >&2
    exit 1
fi
grep -q 'No changes in database schema' "$LOG_DIR/drift-check.log" || {
    echo "The schema drift check did not complete:" >&2
    cat "$LOG_DIR/drift-check.log" >&2
    exit 1
}

echo "Starting the worker."
node dist/index-worker.js > "$LOG_DIR/worker.log" 2>&1 &
worker_pid=$!

echo "Seeding the test catalogue."
node test/e2e/seed-catalog.mjs

echo "Running the end-to-end tests."
node --test "test/e2e/**/*.test.mjs"
