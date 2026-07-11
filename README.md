# Kronos

A scheduler/orchestration dashboard for running agent tasks through ACP with the `kronos` bridge CLI.

## Install

One command — no Node, Bun, or checkout required. The CLI is a single standalone
binary that bundles the Bun runtime.

**macOS / Linux:**

```bash
curl -fsSL https://github.com/Reqeique/Kronos/releases/latest/download/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://github.com/Reqeique/Kronos/releases/latest/download/install.ps1 | iex
```

Verify and get started:

```bash
kronos --version
kronos --help
```

To install a specific version: `KRONOS_VERSION=v1.2.0 curl …/install.sh | bash`
To update: re-run the same one-liner. To uninstall: delete `~/.local/bin/kronos`
(macOS/Linux) or `%LOCALAPPDATA%\kronos\kronos.exe` (Windows).

## What it does

| Area | Feature | Status |
|---|---|---|
| Scheduling | Agent task scheduling from dashboard | Implemented |
| Lifecycle | Task state tracking (`SCHEDULED → DISPATCHED → IN_PROGRESS → terminal`) | Implemented |
| Queue | Streamable-HTTP delivery (`watch-queue`) + polling fallback | Implemented |
| CLI Bridge | ACP stdio bridge and driven ACP mode (`watch-stdio`, `--drive-acp`) | Implemented |
| Mentions | `@` file autocomplete in task descriptions (UI + CLI preprocessing) | Implemented |
| Auth | Bridge-token minting + alias-scoped worker auth | Implemented |
| Observability | Real-time SSE event stream + ACP session titles | Implemented |

## Quick start

1. Open `http://localhost:3737/dashboard`.
2. In **Settings**, register an agent alias (e.g. `oc`).
3. Under **Bridge Tokens**, generate a token and copy it.
4. Run the interactive setup wizard:

   ```bash
   kronos setup
   ```

5. Boot the server and your agent in one command:

   ```bash
   kronos up -- --alias oc --verbose
   ```

6. In the dashboard, create a task assigned to `@oc`. Type `@` in the
   description to autocomplete project files. Status flows live as lifecycle
   events arrive.

> Running from source instead? `npm i && npm run db:push && npm run dev`,
> then `npm run kronos setup`.

## ACP notes

- `kronos up` / `kronos agent` pick active tasks for the alias and forward ACP
  lifecycle events to `/api/acp/events`.
- Queue delivery defaults to Streamable HTTP (`GET /api/bridge/tasks`); use
  `--queue-transport polling --poll-ms 3000` for legacy polling.
- `watch-stdio --drive-acp` preprocesses `@…` mentions into project-file
  paths (`--no-mention-preprocess` to disable).

## Useful commands

```bash
kronos --help          # full command reference
kronos setup           # interactive TUI wizard
kronos agent --alias oc
kronos up              # server + agent in one process
```

## Releasing

Standalone binaries for Linux (x64/arm64), macOS (Intel/Apple Silicon), and
Windows (x64) are built automatically on every `v*` tag and published to
[GitHub Releases](https://github.com/Reqeique/Kronos/releases). See
[`docs/RELEASE.md`](docs/RELEASE.md) for the full pipeline and settings.

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).
