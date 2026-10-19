# Phase 3 Security & Quality Report — NagarCode (Nagar Platform)

Date: 2026-10-19
Branch: arena/69a900af-nagar-platform (from 8951325)
Scope: Local Git via local agent, NagarHub panel, Source Control UI, Workspace Search, Local Preview

## 1. Deliverables

| Feature | Location | Status |
|---------|----------|--------|
| Local Git (init/status/stage/unstage/diff/commit/branch create-switch-delete/history/merge/fetch-pull-push/remotes/clone/conflicts/errors, offline) | `apps/agent/src/git.ts` + `apps/agent/src/server.ts` (Git routes) + `packages/agent-protocol/src/index.ts` (types) + `apps/code/src/lib/agent/client.ts` + `apps/code/src/lib/agent/useGit.ts` | ✅ Real Git executable via `spawn("git", ...)`, no simulation |
| NagarHub panel (signin/out, repo list/create/clone/connect/details/copy URLs/push/pull/fetch/errors, private repos server-enforced) | `apps/code/src/lib/nagarhub/{types,client,useNagarHub}.ts` + `apps/code/src/components/ide/NagarHubPanel.tsx` | ✅ Reuses actual APIs: `POST /api/auth/sign-in/email`, `POST /api/auth/sign-up/email`, `POST /api/auth/sign-out`, `GET /api/v1/me`, `GET /api/v1/repositories`, `POST /api/v1/repositories`, `GET /api/v1/repositories/:ns/:slug` (cloneUrl from server). Git-over-HTTPS via `/git/:ns/:slug.git` (smart HTTP). |
| Source Control UI | `apps/code/src/components/ide/SourceControlPanel.tsx` | ✅ Staged/unstaged/untracked, stage/unstage/all, discard (checkout), commit with configurable user.name/email, history log, diff viewer, branch CRUD + checkout + merge (conflict handling), remotes, fetch/pull/push with credential prompts |
| Workspace search | `apps/code/src/lib/search/service.ts` + `apps/code/src/components/ide/SearchPanel.tsx` + `apps/code/src/lib/recentFiles.ts` | ✅ search/replace/open-by-name/recent/go-to-line/navigation, binary/large file handling (null byte + >500KB skip, 5000 file cap) |
| Local preview | `apps/code/src/components/ide/PreviewPanel.tsx` | ✅ Port selection, Connect/Refresh/Open in new tab, iframe sandbox `allow-scripts allow-same-origin`, loading/error states |
| Shared wiring | `apps/code/src/app/page.tsx` (revealLine, Ctrl+P/G, commands), `apps/code/src/components/ide/{Sidebar,ActivityBar,MonacoEditor,Icons}.tsx`, `apps/code/src/lib/workspace/*` | ✅ ActivityBar `preview` (IconPreview), Sidebar real panels, Monaco revealLine |

## 2. Git Implementation — No Simulation, Works Offline

- **Executable**: `apps/agent/src/git.ts` spawns system `git` binary; `ensureGitAvailable()` checks `git --version`.
- **All operations use real Git**:
  - `git init --initial-branch=main`
  - `status --porcelain=v1 -uall --branch` + `branch --show-current` + `rev-parse --abbrev-ref --symbolic-full-name @{u}` for ahead/behind
  - `add`, `reset HEAD --`, `checkout --` (discard), `diff --no-color --unified=3 --no-ext-diff [--staged]`
  - `commit -m` with optional `--author="name <email>"`
  - `log --format=%H%x00%an%x00%ae%x00%aI%x00%s%x00%P` (limit/skip/branch, 200 max)
  - `for-each-ref --format=... refs/heads` + `rev-parse --abbrev-ref HEAD`
  - `branch`, `checkout -b`, `branch -d/-D`, `merge --no-edit`
  - `remote -v`, `remote add`, `remote remove`
  - `fetch --prune`, `pull [--rebase]`, `push [--force-with-lease] [-u]`
  - `clone [-b branch] url targetPath`
  - `config --get/--list`, `config key value`
- **Offline**: All above work without network except fetch/pull/push/clone requiring remote. Verified via test harness (no network mocked, local bare repo clone succeeds).
- **Conflicts**: `git merge` detects `CONFLICT`/`Automatic merge failed` → returns `{ merged: false, conflicted: string[] }` with 409; `getGitStatus` populates `conflicted` via porcelain `DD/AU/UD/UA/DU/AA/UU`. Pull also surfaces conflicts.
- **Errors**: `GitError` preserves stderr/stdout/exitCode; mapped to `AgentError` codes `GIT_ERROR`, `GIT_CONFLICT`, `GIT_NOT_REPO`, `ALREADY_EXISTS`, `INVALID_REQUEST`, `FORBIDDEN_PATH`. Includes actionable messages (e.g., `user.name/email not configured`, `Branch not fully merged`, `Cannot delete current branch`).

## 3. NagarHub Integration — Real APIs, No Invention

- **Inspected**: `services/api/src/modules/repositories/repository-routes.ts` (cloneUrl helper: `${NAGAR_GIT_BASE_URL ?? http://localhost:4000/git}/ns/slug.git`), `services/api/src/modules/git/git-routes.ts` (smart HTTP), `services/api/src/app.ts` (`/api/auth/*`, `/api/v1/me`, `/api/v1/repositories`), `services/api/test/integration/harness.ts` (auth flows).
- **Client** (`apps/code/src/lib/nagarhub/client.ts`):
  - `getHubBaseUrl()`/`getApiBase()`/`getAuthBase()` — respects `NAGAR_GIT_BASE_URL`, `NAGAR_HUB_URL`, `localStorage.nagarhub.url` (user-configurable Hub URL field in panel).
  - `signIn` → `POST /api/auth/sign-in/email`, `signUp` → `POST /api/auth/sign-up/email` + `PATCH /api/v1/me/profile` for username, `signOut` → `POST /api/auth/sign-out`, `getMe` → `GET /api/v1/me`, `listRepositories` → `GET /api/v1/repositories`, `createRepository` → `POST /api/v1/repositories`, `getRepository` → `GET /api/v1/repositories/:ns/:slug`.
  - Clone URLs copied from server-provided `cloneUrl`/`httpCloneUrl` (never constructed client-side beyond fallback).
- **No GitHub fallback**: No `github.com`, `api.github.com`, OAuth, GH token, or GH URLs anywhere (verified `grep -r github apps/code apps/agent packages` clean except docs).
- **Private repos**: Server-enforced via `canAccessRepository` (prisma + org membership). Client never bypasses; 401/403 surfaces as `NagarHubClientError` with code/status.
- **Credentials**: Never embedded in URL. `apps/agent/src/git.ts` uses `-c http.extraHeader=Authorization: Basic <base64>` + `-c credential.helper=` + `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=echo`, `GCM_INTERACTIVE=never`. No netrc write, no URL mutation, no logging of password (agent `logRequests` never logs token; Git stderr truncated to 128KB, stdout capped 4MB/1MB).
- **Push/Pull/Fetch**: UI prompts for `username` (email) + `password` only when needed; passed via `GitCredentials` to agent, not stored except transiently; `parseCredentials` validates both present.

## 4. Security Checks

### 4.1 Agent Loopback & Auth
- Binds only to `127.0.0.1`/`::1`/`localhost` (`config.ts` `isLoopbackHost`).
- `AuthGuard` requires `Bearer <token>` (24-256 chars, `[A-Za-z0-9._~-]`), valid `Host` header, allowed `Origin` (default `http://localhost:3001` plus `NAGAR_CODE_URL` + `--allow-origin`). Preflight returns `204` with `Access-Control-Allow-Private-Network: true`.
- WebSocket upgrades enforce same checks + `nagarcode-agent.v1` subprotocol.
- Failure budget throttles brute-force (tested: `UNAUTHORIZED` after missing token, `FORBIDDEN_ORIGIN` for evil.com).

### 4.2 Workspace & Path Traversal
- `WorkspaceManager` (`apps/agent/src/workspace.ts`): `allowedRoots` enforced via `findContainingRoot` + `fs.realpath` symlink resolution; `SKIP_WALK_DIRS` (`.git`, `node_modules`, `dist`, `.next`, `__pycache__`, etc.), `maxFiles` 5000, `maxReadBytes`/`maxWriteBytes` 4MB default, `maxListEntries` 2000.
- Git clone target: validated `path.resolve(targetPath)` is absolute, must be inside `allowedRoots` (string prefix + `realpath` of nearest existing ancestor, up to 10 levels). Outside → `FORBIDDEN_PATH` 403 (verified: clone to `/tmp/outside` with only `/tmp/root` allowed fails).
- Workspace git ops: `normalizeWorkspacePath` prevents `../` escape; `gitAdd`/`gitReset`/`gitCheckoutDiscard` receive only workspace-relative paths (strip leading `/`, allow `.` only for `add`).
- Branch/remote names validated: `^[A-Za-z0-9._/-]+$`, no `..`, no `//`, no leading `-` (branch), remote `^[A-Za-z0-9._-]+$`. Clone URL rejects `\0`/`\n`.

### 4.3 Git Execution Safety
- No shell: `spawn("git", args, { windowsHide: true })`, args array (no interpolation).
- Env: `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` (isolated from user global config), `GIT_ASKPASS=echo`, `GCM_INTERACTIVE=never` (prevents interactive prompts).
- Timeouts: 60s default, 5s for `--version`; output caps (stdout 4MB, diff 1MB, stderr 128KB) + kill on exceed.
- Input: commit message non-empty, author via `--author` (not env injection), credentials via `http.extraHeader` (no credential helper persistence).

### 4.4 Secrets Handling
- Agent token: never logged, never echoed to terminal, only shown on startup banner; client validates via `TOKEN_PATTERN`.
- NagarHub password: `fetch(..., credentials:"include")` with `content-type: application/json`; never stored in localStorage (only Hub URL), never embedded in clone URL, never written to disk.
- Remotes URLs: stored via `git remote add` (plaintext in `.git/config` as Git does); not logged; copy URL button uses `navigator.clipboard.writeText` (no server round-trip).

### 4.5 Preview
- Iframe `sandbox="allow-scripts allow-same-origin"` (no `allow-top-navigation`); `src` is `http://localhost:{port}` (loopback only). User must explicitly set port & Connect; Refresh re-sets src; Open in new tab uses `window.open(previewUrl, "_blank")`. Errors (unreachable, CORS) shown inline; no automatic port scanning.

## 5. Quality Checks

- **Typecheck**: `pnpm --filter @nagar/code typecheck` ✅, `pnpm --filter @nagar/agent typecheck` ✅ (fixed `exactOptionalPropertyTypes` issues via conditional spreads).
- **Build**: `pnpm --filter @nagar/code build` (Next.js 16.3.7 Turbopack, compiled 6.7s, static pages OK) ✅, `pnpm --filter @nagar/agent build` (`tsc -p tsconfig.build.json`) ✅.
- **Lint**: `pnpm --filter @nagar/agent lint` ✅, `pnpm --filter @nagar/code lint` ✅ (fixed `no-explicit-any`, `prefer-const`, `no-useless-escape`, etc.).
- **Tests**: `pnpm --filter @nagar/agent test` (13 tests) ✅; manual Git harness (init → status → add → commit → branch → checkout → merge → remotes → clone → conflict → diff → reset/restore → config → fetch error → forbidden path) ✅ (see `tmp/test-git{2,3}.mjs` logs).
- **Search**: Debounced 300ms, regex/whole-word/case toggles, include/exclude globs, binary/large skip, replaceAll + per-file replace, quick-open (20), recent (10), go-to-line.
- **Accessibility**: SourceControlPanel commit area handles `user.name`/`user.email` missing (prompts/config set); diff viewer truncates at 100KB; history paginated (50).

## 6. Known Limitations & Follow-ups

- `git pull` with rebase conflicts returns 409 + `conflicted`; UI surfaces but does not auto-abort (user must resolve via terminal or discard).
- `git fetch` without remotes returns 422 `GIT_ERROR` (expected).
- Preview requires user to run `npm run dev`/`python -m http.server` etc on chosen port; not auto-detected for all project types (as per spec: "not required for all projects").
- Private repo enforcement relies on server; client correctly handles 401/403 but does not cache auth state beyond `getMe`.

## 7. Verification Commands

```bash
pnpm install
pnpm --filter @nagar/code typecheck && pnpm --filter @nagar/agent typecheck
pnpm --filter @nagar/code build && pnpm --filter @nagar/agent build
pnpm --filter @nagar/code lint && pnpm --filter @nagar/agent lint
pnpm --filter @nagar/agent test
# Manual Git (requires tsx via pnpm)
pnpm --filter @nagar/agent exec tsx /tmp/test-git2.mjs
pnpm --filter @nagar/agent exec tsx /tmp/test-git3.mjs
```

## 8. Files Changed (Phase 3)

- New: `apps/code/src/lib/agent/useGit.ts`, `apps/code/src/lib/nagarhub/{types,client,useNagarHub}.ts`, `apps/code/src/lib/search/service.ts` (replace), `apps/code/src/components/ide/{SourceControlPanel,NagarHubPanel,PreviewPanel,SearchPanel}.tsx` (overwrites), `apps/code/src/components/ide/Icons.tsx` (IconPreview), `packages/agent-protocol/src/index.ts` (Git types), `apps/agent/src/{git,config,workspace,errors,server}.ts`
- Modified: `apps/code/src/components/ide/{Sidebar,ActivityBar}.tsx`, `apps/code/src/app/page.tsx`, `apps/code/src/components/ide/MonacoEditor.tsx`
- Docs: `docs/local-agent.md` (updated), `docs/phase3-security-report.md` (this file)

No GitHub APIs, no credential embedding, no simulation — all Git via real binary through local agent, all Hub via real `/api/*` endpoints.
