# Build from the repository root, where the workspace lockfile lives:
#   docker build -f apps/server/Dockerfile -t vendure .
# Matches .nvmrc and the "engines" range in the root package.json.
FROM node:22.23.3

WORKDIR /usr/src/app

# npm ci checks the lockfile against every workspace manifest, so both are copied.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/storefront/package.json apps/storefront/
RUN npm ci --workspace server
COPY apps/server apps/server/
RUN npm run build --workspace server

WORKDIR /usr/src/app/apps/server
