# ADR-002: shared authentication with Better Auth

- **Status:** Accepted
- **Decision:** Use Better Auth for shared email/password identity and cookie-backed sessions, mounted once in the Fastify API and persisted in PostgreSQL through its Prisma adapter.
- **Context:** The three products must share one Nagar account; authentication should not be independently reimplemented by each app. A maintained auth library is safer than custom password/session code.
- **Consequences:** One API is the session authority. `BETTER_AUTH_SECRET`, base URL, trusted origins, and CORS origins must be configured per environment. OAuth, email verification, MFA, account recovery, and production abuse controls are intentionally not enabled in Phase 0; enable and test them before public launch. Prisma schema changes for auth must be generated/reviewed and migrated.
