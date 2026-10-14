# commerce-os

This project was generated with [`@vendure/create`](https://github.com/vendurehq/vendure/tree/master/packages/create).

Useful links:

- [Vendure docs](https://www.vendure.io/docs)
- [Vendure Discord community](https://www.vendure.io/community)
- [Vendure on GitHub](https://github.com/vendurehq/vendure)
- [Vendure plugin template](https://github.com/vendurehq/plugin-template)

## Directory structure

* `/src` contains the source code of your Vendure server. All your custom code and plugins should reside here.
* `/static` contains static (non-code) files such as assets (e.g. uploaded images) and email templates.

## Development

```
npm run dev
```

will start the Vendure server, [worker](https://www.vendure.io/docs/developer-guide/vendure-worker/) and Dashboard.

## Build

```
npm run build
```

will compile the TypeScript sources and build the Dashboard into the `/dist` directory.

## Production

For production, there are many possibilities which depend on your operational requirements as well as your production
hosting environment.

### CORS origins

Set the `CORS_ORIGINS` environment variable to a comma-separated list of the origins your browsers call
the API from, for example `https://example.com,https://admin.example.com`. If you leave it empty, the
server sends no `Access-Control-Allow-Origin` header and a separately hosted storefront or dashboard
gets a CORS error on every request. The dashboard served by the `DashboardPlugin` runs on the same
origin as the API, so it is not affected.

In development (`APP_ENV=dev`) any origin is allowed, so you do not need to set this locally.

### Storefront links, assets and email

Outside development (`APP_ENV` other than `dev`) the server refuses to start until these are set:

| Variable | Purpose |
| --- | --- |
| `STOREFRONT_URL` | Public storefront URL, e.g. `https://shop.example.com`. Verification, password reset and email change links point at `/verify`, `/reset-password` and `/account/verify-email` under it. Must use https. |
| `SMTP_HOST` | SMTP server that sends emails. |
| `SMTP_PORT` | Optional, defaults to `587`. |
| `SMTP_SECURE` | Optional, `true` for implicit TLS (usually port `465`), defaults to `false` (STARTTLS). |
| `SMTP_USER`, `SMTP_PASSWORD` | Optional, but set both or neither. |
| `EMAIL_FROM` | Sender address, e.g. `"My Shop" <noreply@shop.example.com>`. |
| `ASSET_URL_PREFIX` | Optional public URL of uploaded assets, e.g. a CDN. When unset, Vendure derives it from each request. Must use https. |

Without `SMTP_HOST` the EmailPlugin runs in dev mode: it writes emails to `static/email/test-emails`
and serves them, password reset links included, on the unauthenticated `/mailbox` route. That is
the default in development, where `STOREFRONT_URL` falls back to `http://localhost:3003`. Set
`SMTP_HOST` locally to test real delivery, for example against a local SMTP catcher.

### Running directly

You can run the built files directly with the `start` script:

```
npm run start
```

You could also consider using a process manager like [pm2](https://pm2.keymetrics.io/) to run and manage
the server & worker processes.

### Using Docker

We've included a sample [Dockerfile](./Dockerfile) which you can build with the following command:

```
docker build -t vendure .
```

This builds an image and tags it with the name "vendure". We can then run it with:

```
# Run the server
docker run -dp 3000:3000 -e "DB_HOST=host.docker.internal" --name vendure-server vendure npm run start:server

# Run the worker
docker run -dp 3000:3000 -e "DB_HOST=host.docker.internal" --name vendure-worker vendure npm run start:worker
```

Here is a breakdown of the command used above:

- `docker run` - run the image we created with `docker build`
- `-dp 3000:3000` - the `-d` flag means to run in "detached" mode, so it runs in the background and does not take
control of your terminal. `-p 3000:3000` means to expose port 3000 of the container (which is what Vendure listens
on by default) as port 3000 on your host machine.
- `-e "DB_HOST=host.docker.internal"` - the `-e` option allows you to define environment variables. In this case we
are setting the `DB_HOST` to point to a special DNS name that is created by Docker desktop which points to the IP of
the host machine. Note that `host.docker.internal` only exists in a Docker Desktop environment and thus should only be
used in development.
- `--name vendure-server` - we give the container a human-readable name.
- `vendure` - we are referencing the tag we set up during the build.
- `npm run start:server` - this last part is the actual command that should be run inside the container.

### Docker Compose

We've included a [docker-compose.yml](./docker-compose.yml) file which includes configuration for commonly-used
services such as PostgreSQL, MySQL, MariaDB, Elasticsearch and Redis.

To use Docker Compose, you will need to have Docker installed on your machine. Here are installation
instructions for [Mac](https://docs.docker.com/desktop/install/mac-install/), [Windows](https://docs.docker.com/desktop/install/windows-install/),
and [Linux](https://docs.docker.com/desktop/install/linux/).

You can start the services with:

```shell
docker-compose up <service>

# examples:
docker-compose up postgres_db
docker-compose up redis
```

## Plugins

In Vendure, your custom functionality will live in [plugins](https://www.vendure.io/docs/plugins/).
These should be located in the `./src/plugins` directory.

To create a new plugin run:

```
npx vendure add
```

and select `[Plugin] Create a new Vendure plugin`.

## Database

### Starting PostgreSQL

The `postgres_db` service in [docker-compose.yml](./docker-compose.yml) publishes PostgreSQL on port
`6543` and stores its data in the `commerce-os_postgres_db_data` volume. It creates the `vendure`
database and user, so `.env` needs `DB_HOST=localhost`, `DB_PORT=6543`, `DB_NAME=vendure`,
`DB_USERNAME=vendure`, `DB_SCHEMA=public` and a `DB_PASSWORD` of your own, which Compose also reads
from `.env` when it first initialises the volume.

```shell
docker compose up -d postgres_db
docker compose ps postgres_db     # should report "running"
```

The service restarts with Docker (`restart: unless-stopped`). If the server cannot reach port
`6543`, check that the container is running; `docker compose up -d postgres_db` starts it again
without touching its data. Never run `docker compose down -v`, which deletes the volume.

On WSL, `docker` only works inside the distro when Docker Desktop's integration is enabled for it:
Docker Desktop → Settings → Resources → WSL integration → enable the distro → Apply & restart.
Until then, the Windows client works from WSL as `docker.exe`.

### Preparing a new database

Nothing beyond an empty database is needed. On every start, `src/index.ts` runs the pending
migrations before bootstrapping, so the first start creates the schema from
`src/migrations/*-InitialSchema.ts`, and Vendure then adds the default channel, roles and the
SuperAdmin from `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD`. To create the schema without starting
the server, run `npm run migration:run`. Products and other catalogue data are not part of the
schema; add them in the Dashboard or with Vendure's import tools.

### Databases created by the scaffold

`@vendure/create` builds its database with TypeORM's `synchronize` and records no migration. The
`InitialSchema` migration recognises such a database: when every table it would create already
exists, it records itself as applied without changing anything. When only some of them exist it
fails and names the missing tables, and the database must be restored from a backup or reconciled
by hand. Its tables, columns, indexes and constraints were checked to be identical to those
`synchronize` produces for this configuration.

### Migrations

[Migrations](https://docs.vendure.io/guides/developer-guide/migrations/) are required whenever you
change the `customFields` config, add entities in a plugin or upgrade Vendure. Keep
`dbConnectionOptions.synchronize` set to `false`.

1. Change the configuration.
2. Generate the migration against a database that is up to date with the existing migrations:
   ```shell
   npm run migration:generate -- AddProductCustomFields
   ```
   This compares the configured entities with the connected database and writes
   `src/migrations/<timestamp>-AddProductCustomFields.ts`. It reports "No changes" when there is
   nothing to migrate, which also makes it a read-only check that the database is in sync.
3. Review the SQL, then commit the file.
4. Apply it with `npm run migration:run`, or by starting the server. Undo the last migration with
   `npm run migration:revert`.

Files in `src/migrations` must each export only their migration class, because TypeORM loads every
export there as a migration; shared helpers belong elsewhere, like `src/migration-baseline.ts`.

Back up before applying migrations to a database whose data matters:

```shell
docker compose exec -T postgres_db pg_dump -U vendure -d vendure -Fc > vendure-$(date +%Y%m%d-%H%M%S).dump
```

## Troubleshooting

### Error: Could not load the "sharp" module using the \[OS\]-x\[Architecture\] runtime when running Vendure server.

- Make sure your Node version is ^18.17.0 || ^20.3.0 || >=21.0.0 to support the Sharp library.
- Make sure your package manager is up to date.
- **Not recommended**: if none of the above helps to resolve the issue, install sharp specifying your machines OS and Architecture. For example: `pnpm install sharp --config.platform=linux --config.architecture=x64` or `npm install sharp --os linux --cpu x64`
