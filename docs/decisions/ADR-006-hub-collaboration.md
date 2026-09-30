# ADR-006: NagarHub collaboration model

- **Status:** Accepted
- **Date:** 2026-09-30
- **Decision owners:** Nagar platform

## Context

Phase 1 established personal repositories and Git smart HTTP. Phase 2 adds Issues, Labels, Pull Requests, Reviews, explicit access roles, Organizations, Notifications, and Webhooks. These records are relational metadata; Git refs and objects remain in bare repositories.

## Decisions

1. **Repository access is a role check.** Owners have `ADMIN`; explicit collaborators can be `READ`, `WRITE`, or `ADMIN`. Organization `OWNER`/`ADMIN` members inherit repository `ADMIN`, while organization `MEMBER` inherits `WRITE`. Public repositories allow anonymous reads only. A private repository is returned as not found to callers without access.
2. **Repositories have one namespace.** A repository is either personal (`ownerId`) or organization-owned (`organizationId`), never both. The migration adds a database check constraint to enforce this invariant. Personal and organization slug uniqueness is scoped separately.
3. **Issue and pull-request metadata is in PostgreSQL.** Repository-scoped numbers are allocated while locking the repository row. Labels are repository-scoped. A pull request records base/head branches and reviews; merging makes a no-fast-forward merge commit in a temporary local checkout and pushes it back to the bare repository. A review by someone other than the author must be the latest review and be `APPROVED` before merge.
4. **Notifications are user-owned records.** Repository owners, explicit collaborators, and organization members receive relevant issue/PR notifications; actors are excluded. Users can mark one or all notifications read.
5. **Webhook secrets are encrypted at rest.** AES-256-GCM uses `NAGAR_WEBHOOK_ENCRYPTION_KEY`; the raw generated secret is returned once. Deliveries are POSTed over HTTPS with an HMAC-SHA256 header. The destination is DNS-checked and resolved to a public address for each attempt; the connection is pinned to that address, redirects are not followed, and response size/time are capped.
6. **Webhook delivery reliability is intentionally modest for this milestone.** Delivery rows and manual retry are implemented. Dispatch currently runs asynchronously in the API process rather than through a durable queue, so a process crash can lose a delivery attempt. A persistent worker/outbox with exponential retry belongs in a later reliability pass.
7. **The visual system is shared.** All three frontends import `@nagar/ui/neobrutalism.css`: heavy black borders, offset shadows, square geometry, warm paper, electric yellow/blue/coral/lime, a subtle halftone background, and shared focus/interaction states.

## Consequences

- Existing personal Phase 1 repositories remain valid; `ownerId` becomes nullable only so organizations can own repositories, and the check constraint keeps old/new rows unambiguous.
- Organization repositories use the same Git URL shape (`/git/{namespace}/{repository}.git`) and Git storage implementation as personal repositories.
- Webhook receivers must be publicly routable HTTPS endpoints. Local HTTP sinks are deliberately rejected.
- Live migration, auth, and database workflows still require PostgreSQL/Redis and must be exercised in a configured environment.
