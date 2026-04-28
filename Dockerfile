# syntax=docker/dockerfile:1.7

# Install workspace deps (cache-friendly layer)
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

# Build the web app -> apps/web/dist
FROM deps AS web-build
WORKDIR /app
COPY apps/web ./apps/web
RUN cd apps/web && bun run build

# Dev image: source baked in (compose will mount over it for hot-reload)
FROM deps AS dev
WORKDIR /app
COPY apps/server ./apps/server
COPY apps/web ./apps/web
EXPOSE 3000
CMD ["bun", "--hot", "apps/server/src/index.ts"]

# Prod image: server source + drizzle migrations + built web dist, no source mounts
FROM oven/bun:1 AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY apps/server/src ./apps/server/src
COPY apps/server/drizzle ./apps/server/drizzle
COPY --from=web-build /app/apps/web/dist ./apps/web/dist
EXPOSE 3000
CMD ["bun", "apps/server/src/index.ts"]
