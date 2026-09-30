# Nagar

Nagar is a connected developer platform: **NagarHub** for Git hosting and collaboration, **NagarCode** for browser/cloud development, and **NagarDeploy** for deployments. Phases 0 (foundation), 1 (NagarHub core), and 2 (NagarHub collaboration) are implemented and have been run end to end against real PostgreSQL, Redis, and Git (see [Verification](#verification)). All three app shells share Nagar's Neo-brutalist design system; Code and Deploy workflows are still future phases.

## What works today

**Foundation (Phase 0)** — pnpm + Turborepo monorepo, strict TypeScript, ESLint/Prettier, a shared UI package, PostgreSQL (Prisma) and Redis, Better Auth email/password sessions, a Fastify API with health/readiness endpoints, and a GitHub Actions pipeline.

**NagarHub core (Phase 1)** — sign-up/sign-in, public profiles, public/private repositories, Git smart HTTP clone and push (Basic auth with your Nagar email and password), a file browser with safe README rendering, **paginated commit history per branch**, a **branches page** with each branch's tip commit, and binary/oversized-file handling.

**NagarHub collaboration (Phase 2)**

- Issues with repository labels, open/close, editing, and notifications.
- Branch-based pull requests with a **Files changed view (commits, per-file stats, unified diff)**, reviews, and approval-gated merge commits. A pull request can merge once someone with write access approves and **nobody is still requesting changes**.
- Personal and organization-owned repositories, member roles, and inherited repository permissions; the dashboard lists everything you own _and_ everything shared with you.
- Repository collaborators with `READ`, `WRITE`, and `ADMIN` roles; private repository and Git access follows those roles.
- Notification inbox with per-item and mark-all read actions.
- Signed webhooks for pushes (one event per changed ref, with the new commits), issues, and pull-request events; encrypted secrets, delivery history, and manual retry.

## Requirements

- Node.js 20.9 or newer
- pnpm 10 (`corepack enable` is recommended)
- Docker Compose for local PostgreSQL and Redis
- Git on the API host (used by Git smart HTTP and merge operations)

## Quick start

```bash
corepack enable
cp .env.example .env
# Set unique values for BETTER_AUTH_SECRET and NAGAR_WEBHOOK_ENCRYPTION_KEY.
# Generate them with: openssl rand -base64 32  and  openssl rand -hex 32
pnpm infra:up
pnpm install          # also downloads Prisma's engines (pnpm 10 build scripts are allow-listed)
pnpm db:generate
pnpm db:deploy        # applies the committed migrations to an empty or existing database
pnpm dev
```

Use `pnpm db:migrate` (Prisma's interactive `migrate dev`) only when you are _authoring_ a new schema change. `pnpm db:deploy` is what CI and production use.

The apps are available at Hub `http://localhost:3000`, Code `http://localhost:3001`, Deploy `http://localhost:3002`, and API `http://localhost:4000`. Hub forwards same-origin `/api/*` and `/git/*` traffic to the API in development.

## NagarHub workflows

1. Sign up, choose a unique username, and complete your profile.
2. Create a personal repository or an organization and an organization-owned repository.
3. Invite repository collaborators or organization members. Private Git reads and pushes use Nagar email/password with Git's HTTP Basic prompt; use a secure credential manager rather than embedding credentials in the remote URL.
4. Browse **Commits** and **Branches**, open Issues, create labels, file/edit/close issues, open pull requests from pushed branches, read the diff, and review it. Anyone with access can comment; approving or requesting changes needs write access. A pull request can be merged once someone with write access has approved it and no reviewer is still requesting changes (one reviewer's approval never hides another's objection); Nagar makes a no-fast-forward merge commit in the bare repository, one merge at a time per repository.
5. Manage the Inbox and configure repository webhooks under repository **Access & webhooks**. Webhook destinations must be public HTTPS endpoints. The signing secret is shown once, and each request includes `X-Nagar-Signature-256` with an HMAC-SHA256 signature of the raw JSON body.

Git repositories use opaque UUID-backed bare storage under ignored `data/git/`. Pushed code and hooks are never executed on the API host. **Use HTTPS for all non-local deployments.**

## Webhook operations

- Generate `NAGAR_WEBHOOK_ENCRYPTION_KEY` once and keep it stable; it is used to encrypt stored webhook secrets with AES-256-GCM. Losing/changing it requires recreating webhooks.
- Only public HTTPS destinations are accepted. DNS is checked on creation and each delivery, the request is pinned to a resolved public address, redirects are not followed, and request time/response size are capped.
- Delivery records are stored and failed deliveries can be retried from repository settings. Dispatch currently runs asynchronously in the API process, not through a durable queue; a process crash can lose an in-flight delivery. Durable retries belong in a later worker/reliability phase.

## Configuration notes

- `TRUST_PROXY` (default `false`): set it only when the API runs behind a reverse proxy you control. It decides whose IP the Git credential throttle sees; with the default, a spoofed `X-Forwarded-For` is ignored.
- `LOG_LEVEL` (optional): `trace` … `fatal`, or `silent`.
- `NAGAR_API_INTERNAL` is read by the Hub **at build time** (it is baked into the `/api` and `/git` rewrites), so set it before `pnpm build`.
- Turborepo runs tasks in strict environment mode: only the variables listed in `turbo.json` reach tasks. If you add a new environment variable, declare it there (and do **not** pass `NODE_ENV`; `next build` must set it itself).

## Useful checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test        # unit + integration; integration needs the PostgreSQL from `pnpm infra:up`
pnpm build
```

- The API suite has **unit tests** (validation, roles, review decisions, locks, error mapping, Git storage against real repositories) and **integration tests** that start the real API and drive it over HTTP against PostgreSQL and the `git` binary: sign-up/sessions, profiles, repositories, clone/push with Basic auth, commit history/branches/compare, permissions, issues and labels, pull-request review and merge, organizations, notifications, webhooks (including a real HTTPS transport against a local TLS server), and the credential throttle.
- Without a reachable database the integration suites **skip** with a message. CI sets `NAGAR_REQUIRE_DB_TESTS=1`, which turns a missing database into a failure.
- The Hub suite renders the real React components in jsdom against stubbed API responses (merge gating, diff escaping, README safety, editing flows, pagination).

## Verification

Phases 0–2 were audited by running them, not just by reading the code. In a workspace with no Docker, the following were run against **PostgreSQL 17.10** (native binaries), **Redis 7.2.5** (built from source), Node 22, pnpm 10.15, and Git 2.39:

- `prisma migrate deploy` applied all three migrations; the migrated schema was diffed against `schema.prisma` (the only difference is the hand-written one-namespace `CHECK` constraint, which Prisma cannot express).
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (API 122 tests, Hub 38 tests) and `pnpm build` all pass, in Turborepo's strict env mode.
- Every Phase 1/2 flow was driven live through the API and through the Hub's own proxy with the real `git` CLI, and all Hub routes rendered under `next dev`.

What that run could **not** cover, so you should check it in your environment: Prisma's native query engine (the sandbox could not reach `binaries.prisma.sh`, so the run used Prisma's Rust-free client engine with the `pg` adapter; the application code and queries are identical); the GitHub Actions workflow (written but not executed here); a real browser session (none was available; the UI was verified with jsdom component tests and server rendering); and webhook delivery to an external HTTPS receiver (the HTTPS transport is tested against a local TLS server instead).

## Known limitations

- Webhook dispatch runs in the API process and is not durable across a crash; there is no automatic retry, only manual retry. A worker/outbox belongs in a later phase.
- The Git credential throttle is per API process; use shared rate limiting before running more than one instance.
- Git requests are buffered in memory (64 MiB in, 128 MiB out) and Git storage is the API host's local disk.
- Redis currently backs only the readiness check.
- OAuth, email verification, and account recovery are not implemented.

## Repository map

- `apps/hub` — NagarHub account, profiles, repositories, commit history, branches, issues, labels, pull requests with diff review, organization screens, inbox, and access/webhook settings.
- `apps/code`, `apps/deploy` — product landing shells using the shared Neo-brutalist system; product workflows are not implemented yet.
- `services/api` — Fastify API, Better Auth integration, Git smart HTTP, collaboration, organization, notification, and webhook modules.
- `packages/database` — Prisma schema and Phase 0/1/2 migrations.
- `packages/auth` — shared Better Auth configuration backed by PostgreSQL.
- `packages/types`, `packages/ui` — shared contracts, brand components, and Neo-brutalist stylesheet.
- `.github/workflows` — CI: format, lint, migrate, typecheck, test, build against PostgreSQL and Redis services.
- `docs/api`, `docs/architecture`, `docs/decisions` — endpoint reference, architecture, and ADRs.
- `PROJECT.md` — current phase checklist and project status.
