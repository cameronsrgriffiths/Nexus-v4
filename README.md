# Nexus v4

Self-hosted platform for building, hosting, and operating AI agents across SMS, voice, email, web chat widget, Telegram, and WhatsApp.

The product spec lives in [`plan.md`](./plan.md) (frozen baseline) and the v1.0 PRD in GitHub issue [#1](https://github.com/cameronsrgriffiths/Nexus-v4/issues/1). Implementation is broken into vertical-slice issues — this slice ([#2](https://github.com/cameronsrgriffiths/Nexus-v4/issues/2)) bootstraps the monorepo, the Docker Compose bundle, and a `/healthz` that proves Postgres + MinIO + the local embedding service are reachable.

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Docker Desktop (or Docker Engine + Compose v2.20+)

## Dev loop

```bash
bun install
bun run dev
```

That's it. `bun run dev` is shorthand for `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`, which brings up:

| Service     | URL                                       | Purpose                                                  |
| ----------- | ----------------------------------------- | -------------------------------------------------------- |
| Web (Vite)  | http://localhost:5173                     | React frontend with hot module reload                    |
| Server      | http://localhost:3000                     | Hono backend, hot-reloads from `apps/server/src`         |
| `/healthz`  | http://localhost:3000/healthz             | Postgres + MinIO + embedding reachability                |
| Postgres    | localhost:5432 (`nexus` / `nexus`)        | pgvector-enabled image                                   |
| MinIO       | http://localhost:9000 (API)               | Object storage                                           |
| MinIO UI    | http://localhost:9001                     | MinIO console                                            |
| Embedding   | http://localhost:7997                     | Infinity + nomic-embed-text-v1.5 (loads on first run, ~1 min) |

The Vite dev server proxies `/healthz` and `/api/*` back to the server, so the browser only needs port 5173.

To stop and remove dev volumes:

```bash
bun run dev:down
```

If you change a dependency in any `package.json`, rebuild:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
```

## Self-host (production)

```bash
docker compose up
```

That brings up the production-shaped stack: a single Nexus container (Hono serves the built React frontend at `/`, the API at `/healthz` and `/api/*`), Postgres, MinIO, and the embedding service. The browser visits `http://<host>:3000`.

Override defaults via environment variables — `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, etc. See the top of [`docker-compose.yml`](./docker-compose.yml) for the full set.

`CREDENTIAL_ENCRYPTION_KEY` encrypts per-org provider credentials at rest. Set it to a base64-encoded 32-byte secret in production:

```bash
export CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

The compose file ships with a baked-in dev default so a clean checkout boots; rotating away from that default is a self-host step before storing real credentials.

## Layout

```
apps/
  server/       Hono API, Drizzle ORM, MinIO client, embedding client
    src/
    drizzle/    Generated migrations (committed)
  web/          Vite + React 19 + Tailwind v4 frontend
    src/
docker-compose.yml      Production-shaped stack
docker-compose.dev.yml  Dev overrides (source mounts, --hot, Vite container)
Dockerfile              Multi-stage: deps, web-build, dev, prod
tests/smoke.test.ts     End-to-end: docker compose up -> /healthz -> assert
```

## Smoke test

Drives `docker compose up` from a clean state, polls `/healthz`, asserts the response shape, and tears down on exit:

```bash
bun run smoke
```

Allow up to 5 minutes on a cold run (the embedding model is downloaded on first start). Subsequent runs reuse the cached model volume.

## E2E test (auth + dashboard)

Boots a one-off Postgres container, runs migrations, serves the auth API + the
built React app on a single port, and drives a Chromium browser through register
→ dashboard → logout → log back in:

```bash
bun run --filter @nexus/web build
bun run e2e
```

The web build is a prerequisite — the e2e server serves `apps/web/dist`.
