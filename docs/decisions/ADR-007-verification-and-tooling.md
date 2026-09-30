# ADR-007: verification strategy and tooling

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

The first implementation of Phases 0–2 was checked only with lint, typecheck, and tests that never touched a database; its own notes said the database-backed flows had never been run. Running them found real defects (see ADR-005/006 amendments). The tooling also had gaps that only show up on a clean machine or in CI.

## Decisions

1. **Integration tests drive the real thing.** `services/api/test/integration/` starts the real Fastify app on a random port and exercises it over HTTP against PostgreSQL and the real `git` binary: sessions, profiles, repositories, clone/push with Basic auth, history/branches/compare, permissions, issues, pull requests, organizations, notifications, webhooks, and the credential throttle. Mocks are limited to the webhook _network transport_ (so requests can be captured and their signatures verified); the real HTTPS transport is tested separately against a local TLS server. Each suite creates uniquely named data and deletes it afterwards.
2. **Missing infrastructure skips locally and fails in CI.** Without a migrated database the integration suites skip with an explanation; `NAGAR_REQUIRE_DB_TESTS=1` (set in CI) turns that into a failure so a broken service container cannot produce a green build.
3. **The integration harness runs the app in non-test mode.** Better Auth disables its origin (CSRF) protection when `NODE_ENV=test`; the harness sets `NODE_ENV=development` and `LOG_LEVEL=silent` so CSRF protection is actually exercised. The API gained a small `LOG_LEVEL` setting for this.
4. **Git in tests is asynchronous.** The API under test shares the test process's event loop, so a synchronous child process would deadlock the server it is calling.
5. **Turborepo declares its environment.** Turbo's default strict mode removes every variable that is not declared, which made `dotenv -e .env -- turbo …` a no-op for tasks (the Hub silently built its proxy rewrites for `localhost:4000` whatever `NAGAR_API_INTERNAL` said). `turbo.json` now lists the runtime variables under `globalPassThroughEnv` (available, not part of cache keys) and `apps/hub/turbo.json` declares `NAGAR_API_INTERNAL` for the Hub's build (part of its cache key, because it changes the output). `NODE_ENV` is deliberately **not** passed: a `development` value makes `next build` fail.
6. **pnpm 10 build scripts are allow-listed.** pnpm 10 skips dependency install scripts by default. `pnpm.onlyBuiltDependencies` lists `@prisma/client`, `@prisma/engines`, `prisma`, and `esbuild`, so engines are fetched at install time rather than on first use.
7. **CI exists.** `.github/workflows/ci.yml` runs format, lint, migrations, typecheck, tests, and build on PostgreSQL 17 and Redis 7 service containers, matching `docker-compose.yml`.
8. **The placeholder secret cannot reach production.** `.env.example` ships a long placeholder `BETTER_AUTH_SECRET` that passes the length check; the auth package now refuses values starting with `replace-` when `NODE_ENV=production`.
9. **Hub component tests use jsdom.** `jsdom` (^26, which supports the repository's Node 20.9 floor) and `@types/jsdom` are dev-only dependencies of `apps/hub`. They let the real React components be mounted against stubbed API responses (merge gating, diff escaping, README safety, editing, pagination). The test helper installs jsdom _before_ importing React, because React decides whether it is in a browser once, at import time. No test framework was added: tests use `node:test` through `tsx`, like the API.

## Alternatives considered

- **Switching Prisma to the Rust-free client engine with a `pg` adapter** would remove the native engine download entirely and is a reasonable future change, but it alters the database layer and was not needed to fix any defect, so it is out of scope.
- **Playwright end-to-end tests** are the right next layer for the Hub but need browser binaries and a running stack; the jsdom component tests and the live API tests cover the logic until then.

## Consequences

- `pnpm test` needs the PostgreSQL from `pnpm infra:up` to run everything; without it only unit tests run.
- New environment variables must be added to `turbo.json`, otherwise tasks will not see them.
