# Architecture overview

Nagar is a pnpm/Turborepo monorepo with three Next.js apps, a modular Fastify API, and shared packages. NagarHub's Phase 0 foundation, Phase 1 core, and Phase 2 collaboration are implemented. NagarCode and NagarDeploy remain product shells. The backend is a modular service, not a fleet of microservices.

```text
Hub (3000) ─┐
Code (3001) ─┼── HTTP ── API (4000) ── PostgreSQL (auth, Hub metadata, collaboration)
Deploy (3002)┘                    ├── Redis (readiness/cache/queue foundation)
                                  └── Git smart HTTP ── bare repositories (data/git)

Shared packages: Neo-brutalist UI · types · database · auth
```

## NagarHub core and collaboration

- Better Auth provides shared email/password registration, sign-in, sign-out, and cookie sessions. Hub browser calls are same-origin; Next.js rewrites `/api/*` and `/git/*` to the API during development.
- PostgreSQL contains Better Auth records, profile fields, personal/organization namespaces, repository metadata and membership, issues/labels, pull requests/reviews, notifications, and webhook delivery metadata. Prisma migrations are reviewed and versioned.
- A repository belongs to exactly one personal or organization namespace. An SQL check constraint enforces this. Organizations own repositories directly and have OWNER/ADMIN/MEMBER membership; organization admins inherit repo ADMIN and members inherit repo WRITE. Direct repository roles are READ/WRITE/ADMIN. API and Git smart HTTP apply the same permission model; private unauthorized reads are hidden as not found.
- Git object data lives in bare repositories under ignored `data/git/`. Clone/fetch/push use `git http-backend` via a shell-free child process. Pushes trigger subscribed webhook events; no pushed code or Git hooks are executed.
- Issues have scoped labels and numbered open/closed state. Pull requests compare branches recorded in the bare repo; review decisions are stored in PostgreSQL. Merging requires a current approval by a different user and creates a no-fast-forward merge commit using a temporary checkout, then pushes it to the bare repository.
- Notifications are persisted per user. Repository owners, direct collaborators, and organization members receive relevant issue/PR events; the actor is excluded.
- Webhook secrets use AES-256-GCM with `NAGAR_WEBHOOK_ENCRYPTION_KEY`; delivery signatures use HMAC-SHA256. Only HTTPS targets resolving to public IPs are accepted. Each attempt pins the connection to a checked address, blocks redirects, and caps time/response size. Delivery history and manual retries are implemented.
- Webhook dispatch is asynchronous in the API process, not a durable queue/outbox. An API process crash can lose an in-flight attempt. A persistent worker, scheduled retry/backoff, and idempotent outbox are follow-up work.
- Git request/response size ceilings and a per-process failed-credential throttle are present for this single-node milestone. Replace the throttle with shared rate limiting before scaling out.

## Shared visual language

All three frontends import `packages/ui/neobrutalism.css`: warm paper/halftone texture, bold type, heavy black borders, hard-offset shadows, square geometry, bright yellow/blue/coral/lime accents, and shared focus/interaction states. Code/Deploy workflows are not implemented merely because those app shells share the theme.

## Runtime boundary and verification

- PostgreSQL remains the durable source of truth; migrations are under `packages/database/prisma/migrations`.
- Redis is provisioned and checked by readiness; Phase 2 does not rely on a durable background queue.
- Git files are local filesystem storage. Configure backups and move to dedicated storage if deployed; do not place repository objects in PostgreSQL.
- OAuth, email verification, account recovery, persistent job delivery, full database-backed CI integration, and deployment/workspace execution remain future work.
- PostgreSQL and Redis services were unavailable in the coding environment, so migrations and database-backed flows must be smoke-tested after setup. See the root README for steps and limitations.

## Local development

See the root README and `.env.example`. Docker Compose exposes PostgreSQL/Redis on loopback only. Sample credentials are local-only. Use unique stable values for `BETTER_AUTH_SECRET` and `NAGAR_WEBHOOK_ENCRYPTION_KEY`; never publish `.env` or `data/git`.
