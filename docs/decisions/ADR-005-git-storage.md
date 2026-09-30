# ADR-005: bare Git repositories and Git smart HTTP

- **Status:** Accepted; Phase 2 extends the V1 authorization model (see ADR-006). Amended 2026-09-30 after live verification (see Amendments).
- **Decision:** Store each repository as a server-created bare Git repository under an opaque UUID key. Serve clone/fetch/push through Git's `http-backend` CGI process invoked directly (no shell), while keeping ownership, visibility, and profile metadata in PostgreSQL.
- **Context:** Git object data is not relational data. The first milestone must support normal Git clients without executing pushed code on the API host.
- **Authorization:** Public repositories allow anonymous clone/fetch. Private reads and all pushes require an owner session or HTTP Basic credentials verified against Better Auth's credential hash. Git/Basic traffic must use HTTPS outside local development. Writes need `WRITE` or `ADMIN`: the owner, organization members, and explicit collaborators with those roles (ADR-006); everyone else is denied.
- **Limits:** Git request bodies are capped at 64 MiB, generated CGI responses at 128 MiB, and credential failures are throttled in-process. This is a single-node development implementation, not a high-availability Git storage service. The in-process limiter must become shared before horizontally scaling.
- **Consequences:** PostgreSQL `gitPath` stores a relative opaque key, never an absolute host path. The filesystem data directory is ignored by Git and needs backups. Git hooks and build scripts are not run; uploaded source is only stored and browsed.

## Amendments (2026-09-30)

- **Push events fire once, from real ref changes.** The first implementation treated the `info/refs?service=git-receive-pack` advertisement as a write and published a `push` webhook for it _and_ for the pack upload, even when no ref changed. The API now snapshots refs before and after the `git-receive-pack` POST and publishes one event per created, moved, or deleted ref, carrying the ref, before/after ids, and the new commits.
- **The host's Git configuration is ignored.** All Git processes started by the API set `GIT_CONFIG_GLOBAL` to the null device (and `GIT_CONFIG_NOSYSTEM=1`). Otherwise an operator's own settings such as `commit.gpgsign=true` would break repository creation and merges on that machine.
- **Repositories verify what they receive.** `receive.fsckObjects=true` is set on creation.
- **Client address.** The credential throttle keys on the socket address; `TRUST_PROXY` opts in to forwarded headers. The previous hard-coded `trustProxy: false` made every client look like the proxy when the API was deployed behind one.
