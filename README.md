# commerce-os

A full-stack e-commerce application built with [Vendure](https://www.vendure.io/) and [Next.js](https://nextjs.org/docs).

## Project Structure

This is a monorepo using npm workspaces:

```
commerce-os/
├── apps/
│   ├── server/       # Vendure backend (GraphQL API, Admin Dashboard)
│   └── storefront/   # Next.js frontend
└── package.json      # Root workspace configuration
```

## Getting Started

### Node.js

The project uses the Node.js version in [`.nvmrc`](.nvmrc) (22.23.3). The `engines` field in
`package.json` accepts `^22.22.2 || ^24.15.0`, the narrowest range required by the locked
dependencies; Node 24 releases before 24.15.0 do not satisfy it.

In every new WSL terminal, activate it with [nvm](https://github.com/nvm-sh/nvm) before
running any `npm` command:

```bash
cd ~/commerce-os
nvm use            # reads .nvmrc; run `nvm install` once if it is missing
command -v node    # must print a path under ~/.nvm, not /mnt/c/...
```

Without an active nvm version, `npm` in WSL can resolve to the Windows installation
under `/mnt/c/Program Files/nodejs`, which installs Windows-only native binaries into
`node_modules`.

### Database

The server needs PostgreSQL. Start it with `docker compose up -d postgres_db` in `apps/server`;
the schema is created by migrations on the first server start. See
[Database in the server README](apps/server/README.md#database) for setup, migrations and backups.

### Development

Start both the server and storefront in development mode:

```bash
npm run dev
```

Or run them individually:

```bash
# Start only the server
npm run dev:server

# Start only the storefront
npm run dev:storefront
```

### Access Points

- **Vendure Dashboard**: http://localhost:3002/dashboard
- **Shop GraphQL API**: http://localhost:3002/shop-api
- **Admin GraphQL API**: http://localhost:3002/admin-api
- **Storefront**: http://localhost:3003

### Admin Credentials

The Dashboard SuperAdmin account is created on the first server start from
`SUPERADMIN_USERNAME` and `SUPERADMIN_PASSWORD` in `apps/server/.env`, which is not
committed. Before that first start, set both to values of your own, and use a long,
unique password. Never reuse Vendure's publicly documented default credentials.

Changing these variables later does not change the password of an existing SuperAdmin:
change it in the Dashboard instead. Changing `SUPERADMIN_USERNAME` creates an additional
SuperAdmin and leaves the previous account active. Outside development (`APP_ENV` other
than `dev`), the server refuses to start while the configured password is the public
default; this checks the configuration, not the password stored in the database.

Vendure's public default password is only tolerated for a throwaway local database, and the server
logs a "Default superadmin password is configured" warning whenever it is configured. If your local
installation was created with it, change the password in the Dashboard (Settings → Administrators)
and then update `SUPERADMIN_PASSWORD` in `apps/server/.env` to match. Never copy such a database or
`.env` to any shared, staging or production environment.

## Continuous Integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request to `main` and every
push to `main`, with read-only repository permissions, in three independent jobs. Each installs only
its workspace with `npm ci --workspace <name>`, on the Node.js version in `.nvmrc`.

| Job | Runs | A failure means |
| --- | --- | --- |
| Server unit tests and types | `npm test` and `npm run check-types` in `apps/server` | A unit test or a type error in the server; the log names it. |
| Storefront tests, types and lint | `npm test`, `npm run lint`, `npm run check-types` and `npm run upgrade:validate` in `apps/storefront` | A storefront test, lint rule, type error or malformed upgrade note. |
| End-to-end tests on a fresh database | `npm run build:server`, then `npm run test:e2e` in `apps/server`, against PostgreSQL and Mailpit service containers | See below. |

`npm run test:e2e` ([`apps/server/scripts/e2e.sh`](apps/server/scripts/e2e.sh)) prints which stage it
reached, and on failure the last lines of the server and worker logs:

- *The server exited before the API was ready*: start-up failed, for example a migration error or a
  rejected production configuration (the job runs with `APP_ENV=ci`, so the production checks apply).
- *The entities differ from the schema the migrations create*: an entity or custom field changed
  without a migration. Generate one with `npm run migration:generate -- <Name>` in `apps/server`
  and commit it.
- *A seed step failed*, or *search did not list the product*: the Admin API rejected the test data,
  or the worker did not index it.
- *A test failed*: CSRF protection or the storefront's cart, login, checkout or logout flow broke.

The database, SuperAdmin password and cookie secret exist only for the job: the passwords are
generated per run and masked in the logs, and no repository secrets are used. The job does not build
the Dashboard, the storefront's production bundle or the Docker image. The workflow in
`apps/storefront/.github/` belongs to the upstream storefront starter and is not run by GitHub.

To reproduce the end-to-end job locally, start an empty PostgreSQL database, export the environment
of the `e2e` job in the workflow (pointing `DB_*` at your database and with your own
`SUPERADMIN_PASSWORD`, `E2E_ADMIN_PASSWORD` and `COOKIE_SECRET`), then run `npm run build:server` and
`npm run test:e2e` in `apps/server`. Never point it at a database whose data you want to keep.

## Production Build

Build all packages:

```bash
npm run build
```

Start the production server:

```bash
npm run start
```

## Learn More

- [Vendure Documentation](https://docs.vendure.io)
- [Next.js Documentation](https://nextjs.org/docs)
- [Vendure Discord Community](https://vendure.io/community)
