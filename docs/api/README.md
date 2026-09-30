# API reference

Base path: `/api/v1` (JSON). Better Auth endpoints are mounted at `/api/auth/*`. The Hub forwards same-origin `/api/*` and `/git/*` requests to Fastify (the target is `NAGAR_API_INTERNAL`, fixed when the Hub is built). Successful responses are `{ "success": true, "data": ... }`; failures are `{ "success": false, "error": { "code": "...", "message": "..." } }` (see [Errors](#errors)).

## Foundation and repositories

| Method   | Path                                                   | Purpose                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/v1/health`                                       | Liveness; no database dependency.                                                                                                                                                                                            |
| GET      | `/api/v1/ready`                                        | PostgreSQL and Redis readiness; 503 if either is unavailable.                                                                                                                                                                |
| GET      | `/api/v1/me`                                           | Current signed-in user's private profile.                                                                                                                                                                                    |
| PATCH    | `/api/v1/me/profile`                                   | Update display name, username, and bio. Reserved names (see below) are refused.                                                                                                                                              |
| GET      | `/api/v1/users/:username`                              | Public profile and public personal repositories.                                                                                                                                                                             |
| GET      | `/api/v1/repositories`                                 | Every repository the signed-in user can work on: their own, ones they were invited to, and ones owned by their organizations. Each item carries `namespace`, `namespaceType` (`USER`/`ORGANIZATION`), and the user's `role`. |
| POST     | `/api/v1/repositories`                                 | Create a personal repository and bare Git storage.                                                                                                                                                                           |
| GET      | `/api/v1/repositories/:namespace/:repository`          | Metadata, branches, tree, latest commits, and README; accepts `?ref=`. `:namespace` is a username or organization slug.                                                                                                      |
| GET      | `/api/v1/repositories/:namespace/:repository/contents` | Safe tree browsing; accepts `?ref=` and `?path=`.                                                                                                                                                                            |
| GET      | `/api/v1/repositories/:namespace/:repository/blob`     | A file's preview; requires `?path=`, optionally `?ref=`. Returns `content` for text up to 1 MiB, or `binary: true` / `tooLarge: true` (with `size`) and `content: null` otherwise.                                           |
| GET      | `/api/v1/repositories/:namespace/:repository/commits`  | Paginated history of a branch, newest first: `?ref=` (default branch), `?page=` (from 1), `?perPage=` (1–100, default 30). Returns `total`, `hasMore`, and `commits`. An empty repository returns an empty page.             |
| GET      | `/api/v1/repositories/:namespace/:repository/branches` | Each branch with its tip commit (`sha`, `author`, `date`, `message`) and `isDefault`; default branch first, then most recently updated.                                                                                      |
| GET      | `/api/v1/repositories/:namespace/:repository/compare`  | `?base=&head=` (branch names or full commit ids). Returns what `head` would add to `base`: `ahead`/`behind`, commits, per-file `status`/`additions`/`deletions`, and a bounded unified `diff`.                               |
| GET/POST | `/git/:namespace/:repository.git/*`                    | Git smart HTTP clone/fetch/push. Private access uses Nagar credentials (HTTP Basic); push requires `WRITE` or `ADMIN`.                                                                                                       |

**Reserved names.** Usernames and organization slugs cannot be names that would shadow Hub routes or API prefixes (`api`, `git`, `login`, `signup`, `dashboard`, `new`, `settings`, `organizations`, `notifications`, `admin`, …). The API answers `409 NAMESPACE_RESERVED`.

**Limits.** `compare` returns at most 100 commits, 300 files, and 400 KiB of diff text; larger results are flagged with `commitsTruncated`, `filesTruncated`, and `diffTruncated`, and the totals stay exact.

## Collaboration

| Method       | Path                                                                        | Purpose                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET/POST     | `/api/v1/repositories/:namespace/:repository/issues`                        | List open (or `?state=CLOSED`) issues; create an issue (any signed-in user who can read the repository).                                                                                                           |
| PATCH        | `/api/v1/repositories/:namespace/:repository/issues/:number`                | Edit title/body, close, or reopen: writers for any issue, and an issue's author for their own. Changing `labelIds` needs write access.                                                                             |
| GET/POST     | `/api/v1/repositories/:namespace/:repository/labels`                        | List or create repository-scoped labels (write access). Names are unique ignoring case; `color` is 6-digit hex (optional `#`), defaulting to `FFD93D`; an invalid color is a 400.                                  |
| GET/POST     | `/api/v1/repositories/:namespace/:repository/pulls`                         | List pull requests (each with `reviewDecision`, `approvedBy`, `changesRequestedBy`) and branches, or open a branch-to-branch pull request (write access). A branch that adds no commits is refused (`NO_CHANGES`). |
| GET          | `/api/v1/repositories/:namespace/:repository/pulls/:number`                 | One pull request with its reviews and a `comparison` (commits, files, diff). A merged PR shows what its merge brought in; `comparison` is `null` if its branches no longer exist.                                  |
| PATCH        | `/api/v1/repositories/:namespace/:repository/pulls/:number`                 | `{ "state": "CLOSED" \| "MERGED" }` (write access). See [Review and merge rules](#review-and-merge-rules).                                                                                                         |
| POST         | `/api/v1/repositories/:namespace/:repository/pulls/:number/reviews`         | Submit `COMMENTED` (anyone who can read), or `APPROVED` / `CHANGES_REQUESTED` (write access). Authors cannot review their own PR; closed PRs cannot be reviewed.                                                   |
| GET/POST     | `/api/v1/repositories/:namespace/:repository/collaborators`                 | List/add direct repository collaborators (`READ`, `WRITE`, `ADMIN`); repository admins only.                                                                                                                       |
| PATCH/DELETE | `/api/v1/repositories/:namespace/:repository/collaborators/:memberUsername` | Change/remove a direct collaborator.                                                                                                                                                                               |

### Review and merge rules

- Every reviewer has one **standing verdict**: their most recent `APPROVED` or `CHANGES_REQUESTED`. A later `COMMENTED` review does not withdraw it, and a later approval replaces the same reviewer's earlier change request.
- Only reviewers who **currently have write access** count. The author's own reviews never count.
- `reviewDecision` is `CHANGES_REQUESTED` if any counted reviewer is requesting changes, else `APPROVED` if any counted reviewer approves, else `REVIEW_REQUIRED`. One person's approval therefore never hides another person's objection.
- Merging requires `APPROVED` and makes a no-fast-forward merge commit. Refusals are `409`: `APPROVAL_REQUIRED`, `CHANGES_REQUESTED`, `MERGE_CONFLICT` (the base branch is left untouched), `NOTHING_TO_MERGE` (the base already contains every commit), `PULL_REQUEST_CLOSED`. Merges are serialized per repository, so two simultaneous merge requests produce exactly one merge.
- The pull request's author is notified when someone else merges or closes it.

## Organizations, notifications, and webhooks

| Method       | Path                                                                                           | Purpose                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST     | `/api/v1/organizations`                                                                        | List the current user's organizations or create one.                                                                                                                                      |
| GET          | `/api/v1/organizations/:slug`                                                                  | Organization details, membership, and repositories (organization member only).                                                                                                            |
| POST         | `/api/v1/organizations/:slug/repositories`                                                     | Create a repository in an organization where the user is a member.                                                                                                                        |
| POST         | `/api/v1/organizations/:slug/members`                                                          | Add a Nagar username as `MEMBER` or `ADMIN` (organization admin only).                                                                                                                    |
| PATCH/DELETE | `/api/v1/organizations/:slug/members/:username`                                                | Change/remove a member; ownership cannot be removed through this route.                                                                                                                   |
| GET          | `/api/v1/notifications`                                                                        | List the signed-in user's recent notifications and unread count.                                                                                                                          |
| PATCH        | `/api/v1/notifications/:id/read`                                                               | Mark one owned notification read.                                                                                                                                                         |
| POST         | `/api/v1/notifications/read-all`                                                               | Mark all current user's unread notifications read.                                                                                                                                        |
| GET/POST     | `/api/v1/repositories/:namespace/:repository/webhooks`                                         | List configured endpoints/recent deliveries or register a public HTTPS URL and event subscriptions (repository admins; at most 20 per repository). The generated secret is returned once. |
| DELETE       | `/api/v1/repositories/:namespace/:repository/webhooks/:webhookId`                              | Remove an endpoint and its deliveries.                                                                                                                                                    |
| POST         | `/api/v1/repositories/:namespace/:repository/webhooks/:webhookId/deliveries/:deliveryId/retry` | Retry a failed delivery manually (same delivery id and body).                                                                                                                             |

### Webhook events

Subscribable events: `push`, `issues.opened`, `issues.closed`, `issues.reopened`, `pull_request.opened`, `pull_request.reviewed`, `pull_request.closed`, `pull_request.merged`.

Each delivery is a `POST` with `content-type: application/json` and these headers: `X-Nagar-Event`, `X-Nagar-Delivery` (stable across retries; use it to de-duplicate), and `X-Nagar-Signature-256: sha256=<hex>`, the HMAC-SHA256 of the **raw body** keyed with the secret shown when the endpoint was created. Compare it in constant time. Any 2xx response is a success.

The body is always `{ "id", "event", "createdAt", "data" }`. `data` per event:

```jsonc
// push — one delivery per branch or tag that was created, moved, or deleted by a push
{ "ref": "refs/heads/main", "before": "<sha|0000…>", "after": "<sha|0000…>",
  "created": false, "deleted": false,
  "commits": [{ "id": "<sha>", "message": "…", "author": { "name": "…", "email": "…" }, "timestamp": "…" }], // newest first, up to 20
  "pusher": { "id": "…", "username": "…" }, "repository": { "name": "repo", "owner": "namespace" } }

// issues.opened | issues.closed | issues.reopened
{ "issue": { "number": 1, "title": "…", "state": "OPEN" }, "repository": { … }, "sender": { "id": "…", "username": "…" } }

// pull_request.opened | .closed | .merged | .reviewed
{ "pullRequest": { "number": 1, "title": "…", "state": "OPEN", "base": "main", "head": "feature", "mergeCommitSha": null },
  "repository": { … }, "sender": { … },
  "review": { "state": "APPROVED", "body": "…" } } // only for .reviewed
```

A push is announced once, after the refs actually changed: the advertisement request, a no-op push, and a rejected push produce no event.

Secrets are encrypted at rest with `NAGAR_WEBHOOK_ENCRYPTION_KEY`. Destinations must be public HTTPS URLs. The address is checked when the endpoint is created **and again on every delivery**; the connection is pinned to the checked address, the certificate is verified against the configured hostname, redirects are not followed, and time (5 s) and response size (64 KiB) are capped.

## Errors

All failures use the envelope above, with a stable `code`. Common ones:

| Status | Codes                                                                                                                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_JSON`, `INVALID_*` (field validation), `INVALID_PAGINATION`, `NO_CHANGES`, `INVALID_WEBHOOK`, `INVALID_LABEL_COLOR`                                                                                |
| 401    | `UNAUTHENTICATED`, `GIT_AUTH_REQUIRED` (with a `WWW-Authenticate: Basic` challenge)                                                                                                                         |
| 403    | `FORBIDDEN`, `SELF_REVIEW`, `GIT_WRITE_FORBIDDEN`                                                                                                                                                           |
| 404    | `NOT_FOUND`, `REPOSITORY_NOT_FOUND` (also used for private repositories the caller cannot see), `BRANCH_NOT_FOUND`, `PULL_REQUEST_NOT_FOUND`                                                                |
| 409    | `USERNAME_TAKEN`, `NAMESPACE_RESERVED`, `REPOSITORY_EXISTS`, `LABEL_EXISTS`, `PULL_REQUEST_EXISTS`, `APPROVAL_REQUIRED`, `CHANGES_REQUESTED`, `MERGE_CONFLICT`, `NOTHING_TO_MERGE`, `WEBHOOK_LIMIT_REACHED` |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                                                                                                                         |
| 500    | `INTERNAL_ERROR`, `MERGE_FAILED`, `GIT_BACKEND_ERROR` (never include internal details)                                                                                                                      |
| 503    | `DEPENDENCY_UNAVAILABLE` (readiness), `WEBHOOKS_NOT_CONFIGURED`                                                                                                                                             |

## Access and setup notes

- Public repository reads can be anonymous. Private repositories are hidden as not found when the caller has no access.
- Personal owners have `ADMIN`; explicit repository roles are `READ`, `WRITE`, and `ADMIN`. Organization owners/admins inherit repository admin; organization members inherit write. When several apply, the highest wins.
- Set up the environment from `.env.example` (including a stable 32-byte webhook encryption key), then apply migrations with `pnpm db:deploy`.
- The Phase 2 migration is `packages/database/prisma/migrations/20260930150000_hub_collaboration/`. It adds a check constraint requiring each repository to belong to exactly one personal or organization namespace.
- Git credential failures are throttled per client address (12 per 15 minutes). The client address is the socket address unless `TRUST_PROXY` says a reverse proxy is trusted.
- Webhook dispatch is asynchronous in the API process; use delivery history/manual retry and do not assume durable delivery across process crashes.
- Production Git/auth traffic requires HTTPS. Never put a password in a remote URL.
