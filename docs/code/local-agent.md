# NagarCode local development agent

NagarCode Phase 2 connects the browser IDE to your own computer through a small,
loopback-only Node.js process. Files, shells, and language runtimes are real: the
browser sends requests to the agent, and the agent executes them with your user
permissions. There is no cloud container and no simulated terminal output.

```
┌────────────────────────────┐        HTTP + WebSocket       ┌──────────────────────────────┐
│ NagarCode (browser)        │  bearer token, Origin check   │ nagarcode-agent (Node.js)     │
│ http://localhost:3001      │ ────────────────────────────▶ │ http://127.0.0.1:47821        │
│ xterm.js · Monaco · React  │ ◀──────────────────────────── │ workspace · PTY · runtimes    │
└────────────────────────────┘   streamed stdout / events    └──────────────┬───────────────┘
                                                                           │ spawn
                                                              real files, bash/zsh/PowerShell,
                                                              node, tsx/ts-node/transpile, python
```

## Requirements

- Node.js **20.9 or newer** (developed and tested on Node 22)
- pnpm 10 (the repository pins it through Corepack)
- A Chromium/Firefox browser for the IDE; Chrome or Edge is only required for the
  optional browser File System Access fallback
- Python 3 and a TypeScript runner are optional. The agent detects what is
  installed and reports missing tools instead of failing silently.

## Install

From the repository root:

```bash
corepack enable        # once per machine, if pnpm is not installed
pnpm install
pnpm --filter @nagar/agent build
```

`pnpm install` also installs the optional prebuilt PTY module
(`@homebridge/node-pty-prebuilt-multiarch`). If native install scripts are
disabled, the agent still starts and reports that terminals fall back to plain
pipes.

## Start

One command from the repository root:

```bash
pnpm agent
```

or, against the compiled output:

```bash
pnpm --filter @nagar/agent start
```

The agent prints its URL, a fresh token, a pairing link, the allowed origins,
roots, detected shells, and runtime versions. Keep the process running while you
use the IDE. Typical output:

```
NagarCode local agent 0.1.0
  URL        http://127.0.0.1:47821
  Token      <random>
  Pair link  http://localhost:3001/#agent=http%3A%2F%2F127.0.0.1%3A47821&token=<random>
  Origins    http://localhost:3001, http://127.0.0.1:3001, http://[::1]:3001
  Roots      /home/you
  Terminal   PTY (node-pty)
  Runtimes   javascript: v22.x | typescript: tsx 4.x | python: Python 3.x
```

The agent **binds only to loopback** (`127.0.0.1` by default; `::1` and
`localhost` are accepted). It refuses non-loopback hosts, so it cannot be reached
from another machine even if a port is open. Do not put it behind a proxy or a
public tunnel.

### Choosing directories

By default the agent allows your home directory and the current working
directory. Narrow it explicitly:

```bash
pnpm agent -- --allow-root /home/you/projects/my-app --allow-root /tmp/scratch
```

A workspace can only be opened inside one of these roots. Paths are resolved to
their real path before the check, so symlinks cannot escape.

### Options and environment variables

| CLI flag              | Environment variable          | Default                 | Purpose                                                |
| --------------------- | ----------------------------- | ----------------------- | ------------------------------------------------------ |
| `--host`              | `NAGAR_AGENT_HOST`            | `127.0.0.1`             | Loopback host (`127.0.0.1`, `::1`, `localhost`).       |
| `--port`              | `NAGAR_AGENT_PORT`            | `47821`                 | Listening port (0 picks a free port).                  |
| `--token`             | `NAGAR_AGENT_TOKEN`           | random                  | 24–256 character token.                                |
| `--allow-root`        | `NAGAR_AGENT_ALLOWED_ROOTS`   | home + cwd              | Repeatable; `path.delimiter`-separated in the env var. |
| `--allow-origin`      | `NAGAR_AGENT_ALLOWED_ORIGINS` | localhost:3001 variants | Extra exact browser origins.                           |
| `--code-url`          | `NAGAR_CODE_URL`              | `http://localhost:3001` | Base for the pairing link and its origin.              |
| `--node`              | `NAGAR_AGENT_NODE`            | `node` from `PATH`      | Node.js executable.                                    |
| `--python`            | `NAGAR_AGENT_PYTHON`          | auto-detect             | Default Python interpreter.                            |
| `--max-terminals`     | `NAGAR_AGENT_MAX_TERMINALS`   | `8`                     | Concurrent terminal sessions.                          |
| `--idle-minutes`      | `NAGAR_AGENT_IDLE_MINUTES`    | `30`                    | Close detached sessions after this idle time.          |
| `--no-pty`            | `NAGAR_AGENT_DISABLE_PTY=1`   | off                     | Force the pipe fallback.                               |
| `--log`               | `NAGAR_AGENT_LOG=1`           | off                     | Log HTTP requests to stderr.                           |
| `--version`, `--help` | —                             | —                       | Print version or usage.                                |

Size caps (`NAGAR_AGENT_MAX_READ_BYTES`, `NAGAR_AGENT_MAX_WRITE_BYTES`,
`NAGAR_AGENT_MAX_LIST_ENTRIES`, `NAGAR_AGENT_MAX_FILES`) default to 8 MiB reads
and writes and 5000 entries; they are validated on both the agent and the client.

## Connect NagarCode

1. Start NagarCode: `pnpm --filter @nagar/code dev` (http://localhost:3001).
2. Open the pairing link printed by the agent. The token travels in the URL
   fragment (`#agent=…&token=…`), which is never sent to a web server; NagarCode
   reads it, stores the configuration in `localStorage`, and immediately removes
   the fragment from the address bar.
3. Or click the agent chip in the status bar / **Local Agent…** and paste the URL
   and token manually.
4. In the agent dialog, type an absolute path or use **Browse…**, then **Open**.
   The Explorer switches from the demo workspace to the real folder.

The agent must be allowed to accept the page's origin. The default allows
`http://localhost:3001`, `http://127.0.0.1:3001`, and `http://[::1]:3001`. If
you serve NagarCode on a different origin, restart the agent with
`--allow-origin http://host:port`. A page on a remote preview domain cannot reach
your computer's loopback interface; NagarCode shows a warning in that case.

## Use

- **Explorer** — list directories, open files, save with `Ctrl+S`, create files
  and folders, rename, delete, and refresh. Every mutation re-reads the affected
  directories. Save confirmation comes from disk, not local state.
- **Terminal** — open the panel, pick a detected shell, and run commands. Output,
  exit codes, working directory, and `Ctrl+C` come from the real process. Each
  session has its own tab; `Kill` closes the process group. Scrollback is kept by
  the agent, so reloading the page (or a brief network drop) reattaches to the
  same session and replays its buffer. Shells: PowerShell `pwsh`, Windows
  PowerShell, or `cmd` on Windows; `$SHELL`/bash/zsh/sh/dash/fish on
  macOS/Linux.
- **Run** — the editor toolbar runs `.js`/`.mjs`/`.cjs`, `.ts`/`.mts`/`.cts`, and
  `.py`/`.pyw` files. The file is saved first if it is dirty, then executed in a
  new terminal session. The first run shows a warning that code executes with
  your user permissions; NagarCode never runs project scripts just because a
  folder was opened.
- **Runtimes** — JavaScript runs with your local Node.js. TypeScript prefers the
  project's `tsx` or `ts-node`, otherwise it uses the TypeScript compiler's
  `transpileModule` into a hidden `.nagar-run-*.mjs` (or `.cjs`) file, executes
  it, and deletes it. Compile errors include `TSxxxx (file:line:col)`. Python
  uses `python3`, then `python`, then `py -3`; you can set an interpreter per run
  in the agent dialog.
- **Browser fallback** — with no agent connected, **Open a folder in this
  browser instead** still uses the File System Access API (or the in-memory
  workspace). Terminals and Run are disabled in that mode because there is no
  process to execute them.

## Security model

- Loopback-only listening address, validated at startup. No public bind option.
- Every `/api/*` request except `GET /api/health` requires
  `Authorization: Bearer <token>`. Tokens are compared in constant time; failed
  attempts are rate limited (30/minute, then HTTP 429).
- Terminal WebSockets authenticate through the `nagarcode-token.<token>`
  subprotocol and require an allowed `Origin`.
- Every request and WebSocket upgrade validates the `Origin` header against the
  allowlist and the `Host` header against loopback names, which blocks DNS
  rebinding and cross-site command execution from arbitrary websites.
- Paths are workspace-relative POSIX paths. `..`, backslashes, NUL bytes,
  absolute escapes, and symlink escapes are rejected before touching the disk,
  and each resolved path is re-checked against its workspace root.
- File reads/writes, payloads, directory listings, concurrent terminals, and
  terminal input are size/count limited. Terminal input is capped at 64 KiB.
- Console output is only ever forwarded from the child process; the terminal is
  never rendered from simulated strings.
- The token is a local secret. Anyone with it can read and execute as your user;
  do not paste it into chats, screenshots, or remote pages.

## Shut down

Press `Ctrl+C` in the agent terminal. On `SIGINT`/`SIGTERM` the agent closes all
terminal sessions (SIGTERM, then SIGKILL after 1.5 s), terminates WebSocket
clients, closes workspaces, and exits. If the agent exits unexpectedly, NagarCode
shows the disconnected state, stops retrying after three attempts, and offers
**Reconnect**; browser tabs keep their unsaved buffers. To pair with a different
agent, use **Disconnect** (keeps the token) or **Forget token**.

If an agent is unreachable while a save is attempted, the IDE surfaces the error
instead of pretending the file was written.

## API surface (all token-protected unless noted)

```
GET  /api/health                                   public
GET  /api/status                                   agent, workspaces, shells, runtimes
GET  /api/browse?path=...                          directory browser for roots
GET  /api/runtimes?workspaceId=...&pythonPath=...  runtime availability
GET|POST /api/workspaces                           list / open a workspace
DELETE   /api/workspaces/:id                       close a workspace
GET  /api/workspaces/:id/entries?path=...          list a directory
GET  /api/workspaces/:id/file?path=...             read a file
PUT  /api/workspaces/:id/file                      save a file
POST /api/workspaces/:id/files                     create a file
POST /api/workspaces/:id/folders                   create a folder
POST /api/workspaces/:id/rename                    rename
DELETE /api/workspaces/:id/entries?path=...        delete (recursive flag)
GET  /api/workspaces/:id/stat|exists|files         metadata / all files
POST /api/workspaces/:id/runs                      run a JS/TS/Python file
GET|POST /api/terminals                            list / create sessions
GET|PATCH|DELETE /api/terminals/:id                inspect / resize / close
POST /api/terminals/:id/interrupt                  Ctrl+C equivalent
WS   /api/terminals/:id/ws                         stream input/output/resize/exit
```

## Tests

The agent has an integration suite that starts real agents on ephemeral loopback
ports and uses temporary workspaces:

```bash
pnpm --filter @nagar/agent test        # 13 tests, 12 required scenarios
pnpm --filter @nagar/agent lint
pnpm --filter @nagar/agent typecheck
pnpm --filter @nagar/agent build
pnpm --filter @nagar/code lint
pnpm --filter @nagar/code typecheck
pnpm --filter @nagar/code build
```

Covered: real reads/saves verified on disk, create/rename/delete, JavaScript,
TypeScript, Python, real shell commands and exit codes, `Ctrl+C` interruption,
PTY resizing (`stty size`), clean shutdown with live WebSocket disconnection,
path-traversal and symlink rejection, invalid browser origin rejection (HTTP and
WebSocket), and unavailable interpreters.

## Known limitations

- The agent is not a sandbox. Commands run as your user; only open and run code
  you trust.
- Git and NagarHub integration are intentionally out of scope in this phase.
- TypeScript runs through `tsx`/`ts-node` when present; the `transpileModule`
  fallback erases types without resolving relative `.ts` imports or type errors,
  and reports that caveat in the runtime status.
- The agent watches no filesystem events. Changes made by external tools appear
  after **Refresh**; terminal sessions refresh the Explorer when a process exits.
- One workspace is active in the IDE at a time. Opening another closes the
  previous agent workspace (the path remains in recent workspaces).
- Scrollback reattachment is in-memory and lasts as long as the agent process.
  Restarting the agent invalidates old sessions and tokens.
- A web preview served from another host cannot reach `127.0.0.1`; run NagarCode
  locally for the intended workflow.
- Terminal clipboard access depends on browser permissions; `Ctrl+Shift+C/V`
  and the terminal toolbar use the Clipboard API where available.
