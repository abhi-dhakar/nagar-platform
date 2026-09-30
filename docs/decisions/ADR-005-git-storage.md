# ADR-005: bare Git repositories and Git smart HTTP

- **Status:** Accepted; Phase 2 extends the V1 authorization model (see ADR-006).
- **Decision:** Store each repository as a server-created bare Git repository under an opaque UUID key. Serve clone/fetch/push through Git's `http-backend` CGI process invoked directly (no shell), while keeping ownership, visibility, and profile metadata in PostgreSQL.
- **Context:** Git object data is not relational data. The first milestone must support normal Git clients without executing pushed code on the API host.
- **Authorization:** Public repositories allow anonymous clone/fetch. Private reads and all pushes require an owner session or HTTP Basic credentials verified against Better Auth's credential hash. Git/Basic traffic must use HTTPS outside local development. Private non-owner writes are denied; repository membership is not part of V1.
- **Limits:** Git request bodies are capped at 64 MiB, generated CGI responses at 128 MiB, and credential failures are throttled in-process. This is a single-node development implementation, not a high-availability Git storage service. The in-process limiter must become shared before horizontally scaling.
- **Consequences:** PostgreSQL `gitPath` stores a relative opaque key, never an absolute host path. The filesystem data directory is ignored by Git and needs backups. Git hooks and build scripts are not run; uploaded source is only stored and browsed.
