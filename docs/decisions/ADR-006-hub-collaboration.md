# ADR-006: NagarHub collaboration model

- **Status:** Accepted; decisions 3 and 4 amended 2026-09-30 after live verification (see Amendments)
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

## Amendments (2026-09-30)

Running the flows against a real database and Git found behavior the first write-up got wrong. The rules are now:

1. **Reviews collapse into one decision per pull request.** The original rule ("the latest review by anyone but the author must be `APPROVED`") let a second reviewer's approval hide a first reviewer's outstanding request for changes; a pull request with a blocking review merged with HTTP 200. Now each reviewer has a _standing verdict_ (their latest `APPROVED` or `CHANGES_REQUESTED`; comments never withdraw it). The decision is `CHANGES_REQUESTED` if any counted reviewer blocks, `APPROVED` if at least one approves, else `REVIEW_REQUIRED`.
2. **Only people who can merge can gate a merge.** Anyone who can read may comment, but `APPROVED` and `CHANGES_REQUESTED` need write access at submission time, and only reviewers who _currently_ have write access count. Otherwise any signed-in account could approve a pull request on a public repository.
3. **Reviewers can see what they review.** A pull request exposes its commits, per-file statistics, and a bounded unified diff (`GET …/pulls/:number`), computed against the merge base. A branch with nothing to add cannot be opened as a pull request.
4. **Merging is serialized and explicit.** Merges (and closes) for a repository run under an in-process lock, re-read the pull request's state inside it, and record the transition with a conditional update, so concurrent requests produce exactly one merge commit. Conflicts (`MERGE_CONFLICT`), a no-op merge (`NOTHING_TO_MERGE`), and infrastructure failures (`MERGE_FAILED`) are different errors; a push rejected because the base moved is retried from a fresh checkout.
5. **Issue authors manage their own issues.** Writers manage any issue; an issue's author can edit and close their own even with only read access. Labels remain a write-access action, unique per repository ignoring case.
6. **Notifications.** An issue's author is notified when it is closed or reopened; a pull request's author is notified when someone _else_ merges or closes it (not about their own action).
7. **Namespaces are protected.** Usernames and organization slugs share one URL space with Hub routes and API prefixes, so names such as `api`, `git`, or `login` are reserved. Previously any of them could be claimed, shadowing `/git/*` or the login page.
8. **Webhook payloads are consistent** across issue and pull-request events (`{ …, repository, sender }`), and the number of endpoints per repository is capped at 20 because every event fans out to all of them.

Webhook reliability is unchanged and still modest (decision 6 above): in-process dispatch, manual retry, no outbox.
