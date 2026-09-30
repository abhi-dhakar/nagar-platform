# Nagar Developer Platform — Master Project Specification

> **Purpose:** This document is the single source of truth for the Nagar developer-platform ecosystem.
> It is intentionally written so that a human developer, coding agent, or another AI assistant can understand the project without needing the original conversation.
>
> **Status:** Architecture / planning phase
> **Owner:** Abhishek Nagar
> **Primary goal:** Build a connected developer platform consisting of NagarHub, NagarCode, and NagarDeploy.

---

## 1. Project Overview

Nagar is a developer platform made of three tightly integrated products:

1. **NagarHub** — GitHub-style Git hosting and collaboration.
2. **NagarCode** — VS Code-style browser/cloud development environment.
3. **NagarDeploy** — Vercel-style application deployment platform.

These are NOT intended to be shallow visual clones. The objective is to reproduce meaningful engineering workflows and learn/build the underlying systems.

### Core ecosystem flow

```text
                    NAGAR PLATFORM
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
      NagarHub       NagarCode      NagarDeploy
      Git Hosting     Cloud IDE      Deployment
          |              |              |
          +--------------+--------------+
                         |
                    Shared Platform
```

The intended user journey is:

```text
Create Nagar Account
        |
        v
Create Repository in NagarHub
        |
        v
Open Repository in NagarCode
        |
        v
Edit Code / Terminal / Git
        |
        v
Commit + Push
        |
        v
NagarDeploy detects push
        |
        v
Build application
        |
        v
Run Docker container
        |
        v
Live deployment URL
```

---

# 2. Product Goals

## 2.1 NagarHub

Build a Git hosting and collaboration platform with:

- User accounts
- Organizations
- Public/private repositories
- Git clone/push/pull
- Repository browser
- Branches
- Commits
- Issues
- Pull requests
- Code review
- Stars
- Activity feed
- Notifications
- Permissions
- Webhooks
- Repository search

## 2.2 NagarCode

Build a browser-based development environment with:

- File explorer
- Monaco Editor
- Tabs
- Syntax highlighting
- Search
- Integrated terminal
- Git integration
- NagarHub repository import
- Workspace persistence
- Live preview
- Optional AI coding assistant
- Eventually isolated Docker workspaces/sandboxes

## 2.3 NagarDeploy

Build an application deployment platform with:

- Git repository import
- Automatic deployments
- Build logs
- Environment variables
- Deployment history
- Preview deployments
- Production deployments
- Rollbacks
- Custom domains
- Health checks
- Deployment queue
- Docker-based builds
- Resource limits

---

# 3. Non-Goals

Do NOT attempt to reproduce every feature of GitHub, VS Code, or Vercel.

The project should prioritize:

- Working core workflows
- Correct architecture
- Security
- Clear code
- Good developer experience
- Real backend behavior
- Meaningful system-design decisions

Avoid spending disproportionate time on:

- Pixel-perfect UI cloning
- Huge feature counts
- Premature microservices
- Unnecessary abstractions
- Features that are impossible to test locally

---

# 4. Recommended Technology Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query
- Monaco Editor for NagarCode
- xterm.js for terminal UI

## Backend

- Node.js
- TypeScript
- Fastify initially
- REST APIs
- WebSockets where real-time communication is required

## Database

- PostgreSQL
- Prisma or Drizzle ORM

Choose ONE ORM and stay consistent.

## Cache / Queue

- Redis
- BullMQ

## Git

Initial implementation can use the Git CLI where practical.

Future option:

- libgit2 or another Git library if a use case requires it.

## Containers

- Docker

## Reverse Proxy / Routing

- Nginx or Traefik

Choose one initially.

## Storage

S3-compatible object storage for:

- Git-related objects/artifacts where appropriate
- Build artifacts
- Uploaded files
- Logs if needed

## Monorepo

- pnpm
- Turborepo

## Authentication

A shared Nagar account system.

Potential implementation:

- Better Auth or Auth.js

The exact choice should be documented in an ADR before implementation.

---

# 5. Monorepo Structure

Target structure:

```text
nagar/
|
├── apps/
│   ├── hub/                         # NagarHub frontend
│   ├── code/                        # NagarCode frontend
│   └── deploy/                      # NagarDeploy frontend
│
├── services/
│   ├── api/                         # Shared/main backend API
│   ├── git/                         # Git/repository operations
│   ├── deployment/                  # Deployment engine
│   ├── workspace/                   # NagarCode workspace engine
│   └── worker/                      # Background jobs
│
├── packages/
│   ├── ui/                          # Shared UI components
│   ├── database/                    # Database schema/client
│   ├── auth/                        # Shared authentication
│   ├── types/                       # Shared TypeScript types
│   ├── config/                      # Shared configs
│   └── utils/                       # Shared utilities
│
├── infrastructure/
│   ├── docker/
│   ├── nginx/
│   ├── redis/
│   └── postgres/
│
├── scripts/
│   ├── setup.ts
│   ├── seed.ts
│   └── cleanup.ts
│
├── docs/
│   ├── architecture/
│   ├── api/
│   └── decisions/
│
├── .env.example
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.json
└── README.md
```

---

# 6. Initial Simplified Structure

Do not implement every target directory immediately.

Start with:

```text
nagar/
├── apps/
│   ├── hub/
│   ├── code/
│   └── deploy/
│
├── services/
│   ├── api/
│   ├── git/
│   └── worker/
│
├── packages/
│   ├── ui/
│   ├── database/
│   ├── auth/
│   └── types/
│
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

Add `deployment/` and `workspace/` services when their complexity justifies separation.

---

# 7. Architecture Principle: Modular Monolith First

Do NOT begin with many independent microservices.

Use a modular backend plus workers.

Initial architecture:

```text
                         +----------------+
                         |  Nagar Apps    |
                         | Hub/Code/Deploy|
                         +-------+--------+
                                 |
                                 v
                         +----------------+
                         |   API Service  |
                         +-------+--------+
                                 |
             +-------------------+-------------------+
             |                   |                   |
             v                   v                   v
        PostgreSQL            Redis            Object Storage
             |
             v
       Background Jobs
             |
             v
           Workers
```

Later, services can be separated if there is a real technical reason.

---

# 8. Shared Nagar Account

Users should have one Nagar identity across all three products.

```text
                  Nagar Account
                       |
          +------------+------------+
          |            |            |
          v            v            v
      NagarHub     NagarCode    NagarDeploy
```

Authentication should NOT be implemented independently in each application.

Potential login methods:

- Email/password
- Google OAuth
- GitHub OAuth

Later:

- API keys
- Personal access tokens
- SSH keys

---

# 9. NagarHub Architecture

## Frontend

Next.js + TypeScript.

Suggested routes:

```text
/
 /login
 /signup
 /explore
 /dashboard
 /settings

 /[username]
 /[username]/[repository]

 /[username]/[repository]/issues
 /[username]/[repository]/pulls
 /[username]/[repository]/branches
 /[username]/[repository]/settings
```

## Components

```text
components/
├── repository/
├── issues/
├── pull-request/
├── code/
├── commits/
├── branches/
├── profile/
└── navigation/
```

## Backend modules

```text
modules/
├── auth/
├── users/
├── organizations/
├── repositories/
├── branches/
├── commits/
├── issues/
├── pull-requests/
├── permissions/
├── notifications/
└── webhooks/
```

---

# 10. NagarHub Git Model

The application database stores metadata.

Git repository data should not be treated as ordinary PostgreSQL rows.

Conceptually:

```text
PostgreSQL
|
├── users
├── repositories
├── branches
├── issues
├── pull_requests
└── permissions

Git Storage
|
├── repository-a.git
├── repository-b.git
└── repository-c.git
```

Repository metadata should reference the Git storage location.

---

# 11. NagarHub Core Workflow

The first meaningful end-to-end milestone:

```text
Register
   |
Login
   |
Create Repository
   |
Clone Repository
   |
Create File
   |
git add
   |
git commit
   |
git push
   |
NagarHub receives push
   |
Repository browser updates
```

This workflow must work before adding advanced collaboration features.

---

# 12. NagarHub Future Features

After the core Git workflow:

### Phase A
- Repository browser
- Branches
- Commit history
- README rendering

### Phase B
- Issues
- Labels
- Milestones
- Pull requests
- Code review

### Phase C
- Organizations
- Team permissions
- Webhooks
- Notifications
- Search

### Phase D
- CI integration
- NagarDeploy integration
- Advanced repository analytics

---

# 13. NagarCode Architecture

NagarCode is a browser/cloud IDE.

Core UI:

```text
+------------------------------------------------------+
| NagarCode                                            |
+------------+-------------------------+---------------+
| Explorer   | Editor                  | AI Assistant  |
|            |                         |               |
| src/       | app.tsx                 | Chat          |
| public/    |                         | Explain       |
| package    |                         | Fix           |
| README     |                         | Generate      |
+------------+-------------------------+---------------+
| Terminal                                             |
| $ npm run dev                                        |
+------------------------------------------------------+
```

## Frontend technologies

- React
- TypeScript
- Monaco Editor
- xterm.js
- WebSockets
- Tailwind

## Components

```text
components/
├── editor/
├── explorer/
├── terminal/
├── tabs/
├── git/
├── preview/
└── ai/
```

---

# 14. NagarCode Workspace Architecture

The browser should NOT directly execute arbitrary user commands on the host.

Long-term model:

```text
NagarCode UI
     |
     v
Workspace Service
     |
     v
Isolated Workspace
     |
     v
Docker Container
```

Workspace responsibilities:

- Filesystem
- Terminal
- Git
- Build
- Preview
- Process management

Security is a first-class requirement.

Never execute untrusted code directly on the main server.

---

# 15. NagarCode First Milestone

Start with a local/safe workspace implementation.

Required:

```text
Open Workspace
   |
File Explorer
   |
Open File
   |
Edit File
   |
Save
   |
Terminal
   |
Git status
```

Then connect it to NagarHub.

---

# 16. NagarDeploy Architecture

Main workflow:

```text
Git Push
   |
   v
Webhook
   |
   v
Deployment API
   |
   v
Redis/BullMQ
   |
   v
Deployment Worker
   |
   v
Clone Repository
   |
   v
Build
   |
   v
Docker Image
   |
   v
Docker Container
   |
   v
Reverse Proxy
   |
   v
Live Application
```

---

# 17. NagarDeploy Frontend

Suggested routes:

```text
/
 /dashboard
 /projects
 /projects/[id]
 /projects/[id]/deployments
 /projects/[id]/logs
 /projects/[id]/domains
 /projects/[id]/settings
```

Dashboard sections:

- Projects
- Deployments
- Logs
- Domains
- Environment variables
- Usage
- Settings

---

# 18. NagarDeploy Core Features

### V1

- Connect repository
- Select branch
- Deploy
- Build logs
- Deployment history
- Environment variables

### V2

- Automatic deployment
- Webhooks
- Preview deployments
- Rollbacks

### V3

- Custom domains
- HTTPS
- Health checks
- Resource limits
- Usage metrics

---

# 19. Background Jobs

Use Redis + BullMQ.

Example:

```text
Queue:
deployment
    |
    +-- build
    +-- deploy
    +-- cleanup

Queue:
notifications
    |
    +-- issue
    +-- pull-request
    +-- deployment

Queue:
git
    |
    +-- repository-processing
    +-- webhook-processing
```

Workers should be idempotent where possible.

A job retry must not accidentally create duplicate deployments or corrupt state.

---

# 20. Shared Database

Initial PostgreSQL entities:

```text
User
Organization
OrganizationMember

Repository
RepositoryMember

Branch
CommitReference

Issue
IssueComment
IssueLabel

PullRequest
PullRequestReview

Deployment
DeploymentLog
Project
Domain
EnvironmentVariable

Notification
Webhook
AuditLog
```

The exact schema must be designed before implementation of each module.

---

# 21. Redis Responsibilities

Use Redis for:

- Caching
- Rate limiting
- Sessions if needed
- BullMQ queues
- Pub/Sub
- Real-time events
- Temporary state

Do not use Redis as the permanent source of truth for important application data.

---

# 22. Object Storage

Use S3-compatible storage for large/binary objects.

Potential buckets:

```text
nagar-artifacts/
nagar-uploads/
nagar-builds/
nagar-logs/
```

Avoid storing large binary files directly in PostgreSQL.

---

# 23. API Conventions

Use versioned APIs:

```text
/api/v1/auth
/api/v1/users
/api/v1/repositories
/api/v1/issues
/api/v1/pull-requests
/api/v1/deployments
```

HTTP conventions:

```text
GET     /repositories
POST    /repositories
GET     /repositories/:id
PATCH   /repositories/:id
DELETE  /repositories/:id
```

Use consistent response and error formats.

Example:

```json
{
  "success": false,
  "error": {
    "code": "REPOSITORY_NOT_FOUND",
    "message": "Repository was not found"
  }
}
```

---

# 24. Security Requirements

Security is mandatory.

## Authentication

- Secure password hashing
- Secure sessions/tokens
- OAuth state validation
- Session expiration
- Logout/revocation

## Authorization

Use explicit permission checks.

Example:

```text
Repository:
OWNER
ADMIN
MAINTAINER
WRITE
READ
```

Never trust authorization information supplied by the client.

## Deployment security

Untrusted code must execute inside isolation.

Do NOT:

```text
User code -> host shell
```

Prefer:

```text
User code
   |
   v
Isolated container
   |
resource limits
   |
network restrictions
```

Consider:

- CPU limits
- Memory limits
- Disk limits
- Execution timeouts
- Network restrictions
- Process limits

---

# 25. Environment Variables

Never commit secrets.

Use:

```text
.env.local
```

and provide:

```text
.env.example
```

Example:

```env
DATABASE_URL=
REDIS_URL=

AUTH_SECRET=

S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

DOCKER_HOST=
```

Every environment variable must be documented.

---

# 26. Local Development

Recommended:

```bash
pnpm install
```

Start infrastructure:

```bash
docker compose up -d
```

Run development:

```bash
pnpm dev
```

Expected local applications:

```text
NagarHub      http://localhost:3000
NagarCode     http://localhost:3001
NagarDeploy   http://localhost:3002
API           http://localhost:4000
```

Exact ports may change, but must be documented.

---

# 27. Docker Compose

Local infrastructure should eventually include:

```text
postgres
redis
minio
```

Optional:

```text
mailhog
```

for local email testing.

Do not require Docker for basic frontend development if infrastructure is not needed.

---

# 28. Testing Strategy

Use multiple testing levels.

## Unit tests

Test:

- validation
- utilities
- Git helpers
- deployment configuration
- permission logic

## Integration tests

Test:

```text
API + PostgreSQL
API + Redis
Webhook + Queue
Deployment + Worker
```

## End-to-end tests

Critical flows:

### NagarHub

```text
Signup
→ Create repo
→ Push
→ View commit
```

### NagarDeploy

```text
Import repo
→ Deploy
→ Build
→ Running application
```

### NagarCode

```text
Open repo
→ Edit file
→ Save
→ Commit
```

---

# 29. Git Strategy

Use conventional commit messages:

```text
feat:
fix:
refactor:
docs:
test:
chore:
```

Examples:

```text
feat(hub): add repository creation
feat(deploy): add docker build worker
feat(code): add terminal panel
fix(auth): validate session expiration
```

Use feature branches:

```text
main
develop (optional)
feature/...
fix/...
```

Never push unfinished experimental code directly to main.

---

# 30. Documentation Strategy

The repository must remain understandable to future agents.

Required documents:

```text
docs/
├── architecture/
│   ├── overview.md
│   ├── hub.md
│   ├── code.md
│   └── deploy.md
│
├── api/
│   └── README.md
│
└── decisions/
    ├── ADR-001-monorepo.md
    ├── ADR-002-auth.md
    ├── ADR-003-database.md
    └── ADR-004-deployment.md
```

Whenever an important architectural decision changes, create/update an ADR.

---

# 31. AI Agent Rules

Any coding agent working on Nagar must follow these rules:

1. Read `PROJECT.md` before modifying architecture.
2. Read the relevant module documentation before changing that module.
3. Do not rewrite unrelated code.
4. Do not introduce a new library without explaining why it is needed.
5. Prefer existing shared packages over duplicate implementations.
6. Do not introduce microservices without a documented reason.
7. Do not expose secrets.
8. Do not execute untrusted user code on the host.
9. Add tests for important backend behavior.
10. Update documentation when architecture or API behavior changes.
11. Preserve existing API contracts unless the change is intentional and documented.
12. Run relevant tests/lint/type checks before considering a task complete.

---

# 32. AI Agent Task Protocol

When given a task, an agent should follow:

```text
1. Understand task
2. Read PROJECT.md
3. Inspect relevant existing code
4. Identify affected module
5. Explain intended change briefly
6. Implement smallest correct change
7. Run tests
8. Run typecheck
9. Run lint
10. Update documentation if needed
11. Summarize changed files
```

The agent should NOT blindly recreate files that already exist.

---

# 33. Development Roadmap

## Phase 0 — Foundation

- [ ] Create monorepo
- [ ] Configure pnpm
- [ ] Configure Turborepo
- [ ] Configure TypeScript
- [ ] Configure ESLint
- [ ] Create shared UI package
- [ ] Setup PostgreSQL
- [ ] Setup Redis
- [ ] Setup authentication
- [ ] Create API service

## Phase 1 — NagarHub Core

- [ ] User registration/login
- [ ] User profile
- [ ] Create repository
- [ ] Repository page
- [ ] Git repository storage
- [ ] Git clone
- [ ] Git push
- [ ] Commit history
- [ ] Branches
- [ ] README rendering

## Phase 2 — NagarHub Collaboration

- [ ] Issues
- [ ] Labels
- [ ] Pull requests
- [ ] Reviews
- [ ] Permissions
- [ ] Organizations
- [ ] Notifications
- [ ] Webhooks

## Phase 3 — NagarDeploy

- [ ] Project creation
- [ ] Repository connection
- [ ] Deployment API
- [ ] Redis queue
- [ ] Worker
- [ ] Docker build
- [ ] Container execution
- [ ] Logs
- [ ] Deployment status
- [ ] Automatic deployment

## Phase 4 — NagarDeploy Advanced

- [ ] Preview deployments
- [ ] Rollbacks
- [ ] Environment variables
- [ ] Custom domains
- [ ] HTTPS
- [ ] Health checks
- [ ] Resource limits

## Phase 5 — NagarCode

- [ ] Workspace
- [ ] File explorer
- [ ] Monaco editor
- [ ] Tabs
- [ ] File saving
- [ ] Terminal
- [ ] Git integration
- [ ] NagarHub integration
- [ ] Live preview

## Phase 6 — Advanced NagarCode

- [ ] Isolated Docker workspace
- [ ] Multiple language support
- [ ] Collaborative editing
- [ ] AI assistant
- [ ] Workspace snapshots
- [ ] Preview deployments

---

# 34. Integration Roadmap

The products should eventually work together:

### Git integration

```text
NagarCode
    |
    v
NagarHub
```

### Deployment integration

```text
NagarHub
    |
  webhook
    |
    v
NagarDeploy
```

### Full integration

```text
NagarHub
    ↕
NagarCode
    ↕
NagarDeploy
```

---

# 35. Example Full Workflow

A complete future workflow:

```text
1. User signs up for Nagar.

2. User opens NagarHub.

3. User creates:
   username/my-next-app

4. User opens repository in NagarCode.

5. NagarCode creates an isolated workspace.

6. User edits:
   app/page.tsx

7. User runs:
   npm run dev

8. NagarCode shows preview.

9. User commits:
   "feat: create landing page"

10. User pushes to NagarHub.

11. NagarHub emits webhook.

12. NagarDeploy receives webhook.

13. Deployment job enters Redis.

14. Worker picks up the job.

15. Worker clones repository.

16. Worker builds Docker image.

17. Worker starts container.

18. Reverse proxy routes traffic.

19. Deployment becomes READY.

20. User receives:
   https://my-next-app.nagar.dev
```

---

# 36. Design Direction

The three products should share a visual identity but have distinct purposes.

## NagarHub

Feel:

- Developer-focused
- Information dense
- Git-centric
- Professional

## NagarCode

Feel:

- IDE
- Dark
- Keyboard-focused
- Minimal distractions

## NagarDeploy

Feel:

- Infrastructure dashboard
- Clean
- Data-oriented
- Deployment status focused

Shared:

- Same typography
- Same design tokens
- Same component library
- Same account system
- Same navigation conventions where appropriate

---

# 37. Project Quality Rules

A feature is NOT considered complete just because it renders UI.

A feature should have:

```text
UI
+
API
+
Validation
+
Database/state
+
Error handling
+
Loading state
+
Security
+
Tests
+
Documentation
```

For example, "Create Repository" is complete only when:

```text
Form
  ↓
Validation
  ↓
API
  ↓
Authorization
  ↓
Database
  ↓
Git repository creation
  ↓
Response
  ↓
UI update
```

---

# 38. Important Engineering Principles

Always prioritize:

1. Correctness
2. Security
3. Maintainability
4. Observability
5. Performance
6. Developer experience

Do not optimize for scale before measuring actual bottlenecks.

Do not use complex distributed architecture simply because the project is inspired by large companies.

The goal is to understand and implement the underlying engineering ideas at a realistic scale.

---

# 39. Current Project Status

At the beginning of implementation:

```text
NagarHub       [ ] Not started
NagarCode      [ ] Not started
NagarDeploy    [ ] Not started

Monorepo       [ ] Not started
Auth           [ ] Not started
PostgreSQL     [ ] Not started
Redis          [ ] Not started
Git storage    [ ] Not started
Docker         [ ] Not started
CI/CD          [ ] Not started
```

The first implementation target is:

> **NagarHub core Git workflow.**

Do not start advanced NagarCode or NagarDeploy features until the foundation is stable.

---

# 40. Current Priority

## Immediate next steps

```text
1. Initialize monorepo
2. Configure pnpm + Turborepo
3. Create apps:
      hub
      code
      deploy
4. Create services:
      api
      git
      worker
5. Create packages:
      ui
      database
      auth
      types
6. Setup PostgreSQL
7. Setup Redis
8. Implement shared authentication
9. Implement NagarHub repository creation
10. Implement Git storage
11. Implement clone/push
```

---

# 41. Definition of Done for NagarHub V1

NagarHub V1 is complete when a user can:

```text
Register
   ↓
Login
   ↓
Create repository
   ↓
Clone repository
   ↓
Create/edit files locally
   ↓
Commit
   ↓
Push
   ↓
See commits on NagarHub
   ↓
Browse repository files
   ↓
View branches
```

Only after this should advanced features become the priority.

---

# 42. How Another AI Agent Should Understand This Project

If this document is provided to another AI assistant, it should assume:

- Nagar is the overall developer platform.
- NagarHub = Git hosting/collaboration.
- NagarCode = browser/cloud IDE.
- NagarDeploy = deployment platform.
- All three share authentication and core infrastructure.
- The project uses a pnpm/Turborepo monorepo.
- The architecture starts as a modular monolith plus workers.
- PostgreSQL is the source of truth for application metadata.
- Redis is used for caching/queues/realtime support.
- Docker is used for isolated builds/workspaces.
- Security is especially important around user code execution.
- The first implementation priority is NagarHub core Git functionality.
- Existing architecture should be preserved unless there is a documented reason to change it.

Before making architectural changes, the agent should inspect the current repository and this document, then update the relevant documentation after the change.

---

# 43. One-Line Project Description

> **Nagar is an integrated developer platform combining Git hosting, a browser-based development environment, and automated application deployment.**

---

# 44. Short Portfolio Description

> **Built Nagar, a developer platform consisting of NagarHub for Git hosting, NagarCode for browser-based development, and NagarDeploy for automated Docker-based application deployment.**

