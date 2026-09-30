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
- Git object data lives in bare repositories under ignored `data/git/`. Clone/fetch/push use `git http-backend` via a shell-free child process. Every Git process the API starts ignores the host's personal Git configuration (`GIT_CONFIG_GLOBAL` is the null device), so signing keys or aliases on the server can never change behavior, and repositories reject malformed objects at push time (`receive.fsckObjects`). No pushed code or Git hooks are executed.
- Browsing is read-only Git plumbing: paginated `git log`, `for-each-ref` for branches, and bounded `git diff` (400 KiB, 300 files, 100 commits) for pull-request review. Refs and paths are validated against the repository's real branches before they reach Git.
- A push is announced once: the API snapshots the repository's refs before and after the `git-receive-pack` request and publishes one `push` event per ref that actually changed, with the new commits. The preceding `info/refs` advertisement, no-op pushes, and rejected pushes publish nothing.
- Issues have scoped labels and numbered open/closed state; their authors can edit and close their own. Pull requests compare branches recorded in the bare repo; reviews are stored in PostgreSQL and collapsed into one decision by `summarizeReviews`: each reviewer has a standing verdict, only reviewers with write access count, and any outstanding request for changes blocks the merge. Merging runs under a per-repository lock, creates a no-fast-forward merge commit in a temporary checkout, and pushes it to the bare repository; conflicts and no-op merges are reported as distinct errors and leave the base branch untouched.
- Notifications are persisted per user. Repository owners, direct collaborators, and organization members receive relevant issue/PR events; the actor is excluded.
- Webhook secrets use AES-256-GCM with `NAGAR_WEBHOOK_ENCRYPTION_KEY`; delivery signatures use HMAC-SHA256. Only HTTPS targets resolving to public IPs are accepted. Each attempt pins the connection to a checked address, blocks redirects, and caps time/response size. Delivery history and manual retries are implemented.
- Webhook dispatch is asynchronous in the API process, not a durable queue/outbox. An API process crash can lose an in-flight attempt. A persistent worker, scheduled retry/backoff, and idempotent outbox are follow-up work.
- Git request/response size ceilings and a per-process failed-credential throttle are present for this single-node milestone. The throttle keys on the socket address unless `TRUST_PROXY` marks a reverse proxy as trusted. Replace the throttle with shared rate limiting before scaling out.
- Every API error uses one envelope with a stable code (`toErrorResponse`); server faults never leak details.

## Shared visual language

All three frontends import `packages/ui/neobrutalism.css`: warm paper/halftone texture, bold type, heavy black borders, hard-offset shadows, square geometry, bright yellow/blue/coral/lime accents, and shared focus/interaction states. Code/Deploy workflows are not implemented merely because those app shells share the theme.

## Runtime boundary and verification

- PostgreSQL remains the durable source of truth; migrations are under `packages/database/prisma/migrations`. Apply them with `pnpm db:deploy`.
- Redis is provisioned and checked by readiness; nothing else uses it yet and Phase 2 does not rely on a durable background queue.
- Git files are local filesystem storage. Configure backups and move to dedicated storage if deployed; do not place repository objects in PostgreSQL.
- OAuth, email verification, account recovery, persistent job delivery, and deployment/workspace execution remain future work.
- **Tests and CI.** The API has unit tests and integration tests that start the real API and drive it against PostgreSQL and the `git` binary; the Hub has jsdom component tests. `.github/workflows/ci.yml` runs format, lint, migrate, typecheck, test (with `NAGAR_REQUIRE_DB_TESTS=1`), and build against PostgreSQL 17 and Redis 7 services. See [ADR-007](../decisions/ADR-007-verification-and-tooling.md) and the README's Verification section for what was run and what could not be.

## Local development

See the root README and `.env.example`. Docker Compose exposes PostgreSQL/Redis on loopback only. Sample credentials are local-only. Use unique stable values for `BETTER_AUTH_SECRET` and `NAGAR_WEBHOOK_ENCRYPTION_KEY`; never publish `.env` or `data/git`.
