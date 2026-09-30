# NagarHub Git operations

The Phase 1 Git HTTP implementation lives inside the modular API at `services/api/src/modules/git/`; this folder remains reserved for a future service extraction if there is an operational reason. Git repositories are bare repositories in the ignored local `data/git/` directory, keyed by generated UUIDs rather than user-controlled paths. The API invokes `git http-backend` without a shell, applies request/response size limits, and authorizes every private read and push. User-pushed code is stored, never executed.

Git Basic credentials are the Nagar email and account password. Production must serve Git and auth only over HTTPS and should replace the in-process credential throttle with shared, persistent rate limiting before scaling out.
