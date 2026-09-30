# ADR-001: pnpm and Turborepo monorepo

- **Status:** Accepted
- **Decision:** Use pnpm workspaces with Turborepo task orchestration.
- **Context:** Hub, Code, Deploy, and backend modules share types, UI, database, and identity. Starting as one coordinated repository simplifies local development and avoids premature service boundaries.
- **Consequences:** Shared packages are versioned together; package boundaries are explicit. Services may be split later only for an operational or technical reason. CI should run the same Turbo tasks as local development.
