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
