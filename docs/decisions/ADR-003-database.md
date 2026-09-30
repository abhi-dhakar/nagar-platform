# ADR-003: PostgreSQL, Prisma, and Redis

- **Status:** Accepted
- **Decision:** PostgreSQL is the durable metadata store, Prisma is the single ORM, and Redis is provisioned for cache/queue needs.
- **Context:** Shared identity, public profiles, and NagarHub repository metadata need relational constraints and transactions. Git object data lives in bare repositories rather than PostgreSQL. Queue/cache state should not replace PostgreSQL as the source of truth.
- **Consequences:** Schema changes use Prisma migrations. Redis is optional to application semantics except for readiness in this initial local API; it is not used as permanent storage. Production connection strings and credentials must come from secret management.
