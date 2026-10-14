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
