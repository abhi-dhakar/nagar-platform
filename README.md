# Nagar

Nagar is a connected developer platform: **NagarHub** for Git hosting and collaboration, **NagarCode** for browser/cloud development, and **NagarDeploy** for deployments. Phase 0 (foundation) and Phase 1 (NagarHub core) are implemented. Phase 2 adds collaboration across repositories and teams. All three app shells now share Nagar's Neo-brutalist design system; Code and Deploy workflows are still future phases.

## Phase 2 highlights

- Issues with repository labels, open/close states, and collaborator notifications.
- Branch-based pull requests, reviews, approval-gated merge commits, and merge/close events.
- Personal and organization-owned repositories, organizations, member roles, and inherited repository permissions.
- Repository collaborators with `READ`, `WRITE`, and `ADMIN` roles; private repository and Git access follows those roles.
- Notification inbox with per-item and mark-all read actions.
- Signed webhooks for pushes, issues, and pull-request events, encrypted secrets, delivery history, and manual retry.
- Shared Neo-brutalist styling across Hub, Code, Deploy, and the shared UI: hard borders and shadows, square forms, halftone paper, electric yellow/blue/coral/lime.

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
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

The apps are available at Hub `http://localhost:3000`, Code `http://localhost:3001`, Deploy `http://localhost:3002`, and API `http://localhost:4000`. Hub forwards same-origin `/api/*` and `/git/*` traffic to the API in development.

## NagarHub workflows

1. Sign up, choose a unique username, and complete your profile.
2. Create a personal repository or an organization and an organization-owned repository.
3. Invite repository collaborators or organization members. Private Git reads and pushes use Nagar email/password with Git's HTTP Basic prompt; use a secure credential manager rather than embedding credentials in the remote URL.
4. Open Issues, create labels, file/close issues, open pull requests from pushed branches, and review changes. A pull request can be merged only after its latest review is an approval by another user; Nagar makes a no-fast-forward merge commit in the bare repository.
5. Manage the Inbox and configure repository webhooks under repository **Access & webhooks**. Webhook destinations must be public HTTPS endpoints. The signing secret is shown once, and each request includes `X-Nagar-Signature-256` with an HMAC-SHA256 signature of the raw JSON body.

Git repositories use opaque UUID-backed bare storage under ignored `data/git/`. Pushed code and hooks are never executed on the API host. **Use HTTPS for all non-local deployments.**

## Webhook operations

- Generate `NAGAR_WEBHOOK_ENCRYPTION_KEY` once and keep it stable; it is used to encrypt stored webhook secrets with AES-256-GCM. Losing/changing it requires recreating webhooks.
- Only public HTTPS destinations are accepted. DNS is checked on creation and each delivery, the request is pinned to a resolved public address, redirects are not followed, and request time/response size are capped.
- Delivery records are stored and failed deliveries can be retried from repository settings. Dispatch currently runs asynchronously in the API process, not through a durable queue; a process crash can lose an in-flight delivery. Durable retries belong in a later worker/reliability phase.

## Useful checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

API tests cover health/session behavior, route registration, input and access rules, Git smart HTTP clone/push, pull-request merge against a temporary bare repository, and webhook signing/secret/URL protections. Prisma schema validation and migration generation are separate from applying migrations to a live database.

## Verification boundary

The code and migrations are implemented and checked locally, but database-backed flows require PostgreSQL and Redis. In an environment where those services are unavailable, do not treat signup → organization/repository creation → issue/PR → notifications/webhook delivery as live end-to-end verified. Apply migrations and exercise those flows after `pnpm infra:up` in a configured environment. This workspace has not used a live PostgreSQL/Redis instance to validate Phase 2.

## Repository map

- `apps/hub` — NagarHub account, profiles, repositories, issues, labels, pull requests, organization screens, inbox, and access/webhook settings.
- `apps/code`, `apps/deploy` — product landing shells using the shared Neo-brutalist system; product workflows are not implemented yet.
- `services/api` — Fastify API, Better Auth integration, Git smart HTTP, collaboration, organization, notification, and webhook modules.
- `packages/database` — Prisma schema and Phase 0/1/2 migrations.
- `packages/auth` — shared Better Auth configuration backed by PostgreSQL.
- `packages/types`, `packages/ui` — shared contracts, brand components, and Neo-brutalist stylesheet.
- `docs/api`, `docs/architecture`, `docs/decisions` — endpoint reference, architecture, and ADRs.
- `PROJECT.md` — current phase checklist and project status.
