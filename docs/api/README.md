# API reference

Base path: `/api/v1` (JSON). Better Auth endpoints are mounted at `/api/auth/*`. The Hub dev server forwards same-origin `/api/*` and `/git/*` requests to Fastify. JSON responses use `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`.

## Foundation and repositories

| Method   | Path                                                   | Purpose                                                                                                          |
| -------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/v1/health`                                       | Liveness; no database dependency.                                                                                |
| GET      | `/api/v1/ready`                                        | PostgreSQL and Redis readiness; 503 if unavailable.                                                              |
| GET      | `/api/v1/me`                                           | Current signed-in user's private profile.                                                                        |
| PATCH    | `/api/v1/me/profile`                                   | Update display name, username, and bio.                                                                          |
| GET      | `/api/v1/users/:username`                              | Public profile and public personal repositories.                                                                 |
| GET      | `/api/v1/repositories`                                 | Signed-in user's personal repositories.                                                                          |
| POST     | `/api/v1/repositories`                                 | Create a personal repository and bare Git storage.                                                               |
| GET      | `/api/v1/repositories/:namespace/:repository`          | Metadata, branches, tree, commits, and README; accepts `?ref=`. `:namespace` is a username or organization slug. |
| GET      | `/api/v1/repositories/:namespace/:repository/contents` | Safe tree browsing; accepts `?ref=` and `?path=`.                                                                |
| GET      | `/api/v1/repositories/:namespace/:repository/blob`     | UTF-8 text up to 1 MiB; requires `?path=` and optionally `?ref=`.                                                |
| GET/POST | `/git/:namespace/:repository.git/*`                    | Git smart HTTP clone/fetch/push. Private access uses Nagar credentials; push requires `WRITE` or `ADMIN`.        |

## Collaboration

| Method       | Path                                                                        | Purpose                                                                                                                          |
| ------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST     | `/api/v1/repositories/:namespace/:repository/issues`                        | List open (or `?state=CLOSED`) issues; create an issue.                                                                          |
| PATCH        | `/api/v1/repositories/:namespace/:repository/issues/:number`                | Edit title/body, update labels, close, or reopen an issue.                                                                       |
| GET/POST     | `/api/v1/repositories/:namespace/:repository/labels`                        | List or create repository-scoped labels.                                                                                         |
| GET/POST     | `/api/v1/repositories/:namespace/:repository/pulls`                         | List pull requests/branches or open a branch-to-branch pull request.                                                             |
| PATCH        | `/api/v1/repositories/:namespace/:repository/pulls/:number`                 | Close or merge an open PR. Merge requires a latest approval by someone other than the author and makes a no-fast-forward commit. |
| POST         | `/api/v1/repositories/:namespace/:repository/pulls/:number/reviews`         | Submit `APPROVED`, `COMMENTED`, or `CHANGES_REQUESTED`; authors cannot review their own PR.                                      |
| GET/POST     | `/api/v1/repositories/:namespace/:repository/collaborators`                 | List/add direct repository collaborators (`READ`, `WRITE`, `ADMIN`).                                                             |
| PATCH/DELETE | `/api/v1/repositories/:namespace/:repository/collaborators/:memberUsername` | Change/remove a direct collaborator.                                                                                             |

## Organizations, notifications, and webhooks

| Method       | Path                                                                                           | Purpose                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET/POST     | `/api/v1/organizations`                                                                        | List the current user's organizations or create one.                                                                                       |
| GET          | `/api/v1/organizations/:slug`                                                                  | Organization details, membership, and repositories (organization member only).                                                             |
| POST         | `/api/v1/organizations/:slug/repositories`                                                     | Create a repository in an organization where the user is a member.                                                                         |
| POST         | `/api/v1/organizations/:slug/members`                                                          | Add a Nagar username as `MEMBER` or `ADMIN` (organization admin only).                                                                     |
| PATCH/DELETE | `/api/v1/organizations/:slug/members/:username`                                                | Change/remove a member; ownership cannot be removed through this route.                                                                    |
| GET          | `/api/v1/notifications`                                                                        | List the signed-in user's recent notifications and unread count.                                                                           |
| PATCH        | `/api/v1/notifications/:id/read`                                                               | Mark one owned notification read.                                                                                                          |
| POST         | `/api/v1/notifications/read-all`                                                               | Mark all current user's unread notifications read.                                                                                         |
| GET/POST     | `/api/v1/repositories/:namespace/:repository/webhooks`                                         | List configured endpoints/recent deliveries or register a public HTTPS URL and event subscriptions. The generated secret is returned once. |
| DELETE       | `/api/v1/repositories/:namespace/:repository/webhooks/:webhookId`                              | Remove an endpoint and its deliveries.                                                                                                     |
| POST         | `/api/v1/repositories/:namespace/:repository/webhooks/:webhookId/deliveries/:deliveryId/retry` | Retry a failed delivery manually.                                                                                                          |

Supported webhooks: `push`, `issues.opened`, `issues.closed`, `issues.reopened`, `pull_request.opened`, `pull_request.reviewed`, `pull_request.closed`, `pull_request.merged`. Payloads are JSON; `X-Nagar-Event`, `X-Nagar-Delivery`, and `X-Nagar-Signature-256` headers identify and sign the event. Verify the HMAC-SHA256 signature against the raw body. Secrets are encrypted at rest using `NAGAR_WEBHOOK_ENCRYPTION_KEY`. Destinations must be HTTPS and resolve to public IP addresses.

## Access and setup notes

- Public repository reads can be anonymous. Private repositories are hidden as not found when the caller has no access.
- Personal owners have `ADMIN`; explicit repository roles are `READ`, `WRITE`, and `ADMIN`. Organization owners/admins inherit repository admin; organization members inherit write.
- Set up the environment from `.env.example`, including a stable 32-byte webhook encryption key, then apply migrations with `pnpm db:migrate`.
- The Phase 2 migration is `packages/database/prisma/migrations/20260930150000_hub_collaboration/`. It adds a check constraint requiring each repository to belong to exactly one personal or organization namespace.
- Webhook dispatch is asynchronous in the API process for this phase; use delivery history/manual retry and do not assume durable queue delivery across process crashes.
- Production Git/auth traffic requires HTTPS. Never put a password in a remote URL.
