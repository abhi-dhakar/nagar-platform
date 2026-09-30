# ADR-004: Fastify modular API

- **Status:** Accepted
- **Decision:** Start with one versioned Fastify API (`/api/v1`) and keep product capabilities in modules/packages until separation is justified.
- **Context:** This keeps the initial platform testable without the deployment and operational cost of several microservices.
- **Consequences:** API contracts and error envelopes are documented centrally. Add route modules and tests with future domain capabilities; do not expose arbitrary host execution endpoints.
