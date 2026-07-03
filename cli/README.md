# Kronos CLI Bridge

## Quickstart (new wizard)

```bash
# One-shot: boots the dev server (if not running) and runs the agent in one process.
kronos up        # (or: ./kronos.exe up on a binary, or: npm run kronos -- up)

# Same as `up`, but blocks on the dev server only — lets you keep it alive in another shell.
kronos serve

# Stops a dev server that this CLI process spawned.
kronos down

# Interactive TUI: probes server, opens browser to /settings, mints/uses a token,
# and can pre-create the agent alias on the server via the bridge endpoint.
kronos setup          # (or: npm run setup, or: ./kronos.exe setup on a binary)
```

The CLI **auto-bootstraps the dev server** (`bun run start` / `npm run start`) from
a detected Kronos checkout when the configured server URL isn't reachable.

- **Default port**: `3737` (a Kronos-themed, low-collision port — avoids the
  popular 3000 React/Next/Rails dev-server default). Override with
  `KRONOS_PORT=<n>` (env) or `--port <n>` (flag), or `--server <url>`.
- **Runner**: `bun` (preferred when present), else `npm`. The CLI does **not**
  install either — it expects one to already be on `PATH`.
- **Mode**: `prod` (default) — runs `bun run build` (only when `.next/` is
  missing) then `bun run start`. Pass `--dev` for `next dev` (HMR).
- **Discovery**: walks up from `cwd`, then honors `KRONOS_INSTALL_DIR`, then
  walks up from the binary's own folder — looking for `package.json` whose
  `name` is `"kronos"`. Pass `--no-server` to any subcommand to disable.
- **Port collision**: if the chosen port is busy, the CLI walks a small fallback
  list (`3737 → 7766 → 8789`) and warns before spawning.

### Wizard Flow (`kronos setup` → "Full setup")

1. Pick mode via select.
2. **Server URL** — defaults to `http://localhost:3737`; pressing Enter persists it.
3. **Agent command** — defaults to `opencode acp`; pressing Enter persists it.
4. **Probe server** — spinner pings `${server}/api/health` (auto-spawns `bun|npm run start`
   if the server is down and a kronos checkout is nearby).
5. **Open browser to `${server}/settings`** — `Enter` defaults to `Yes`. Cross-platform
   (Windows: `cmd /c start`, macOS: `open`, Linux: `xdg-open`). On the page, sign in,
   click **Bridge Token → Generate**, and copy the token.
6. **Paste token** — `prompts.password()` masks input; validates length ≥ 8.
7. **Pick / define alias** — if `GET /api/bridge/agents?token=...` returns existing
   aliases, you choose from a select. Otherwise pick `+ Different / new alias...`
   and provide a fresh @handle.
8. **Auto-create alias** — if the alias doesn't exist on the server, the wizard
   calls `POST /api/bridge/agents` (bridge-token authenticated) so the alias is
   registered with the user that issued the token. Idempotent; existing aliases
   are kept.
9. **Save** to `~/.kronos/config.json`.
10. *(Optional)* start the agent now with the saved values.

For non-interactive use, prefer `kronos login --token <token> --server <url>`.

### `kronos up` vs `kronos setup` + `kronos agent`

| Use case | Command |
|---|---|
| Run the whole product from a single shell (built server + worker). | `kronos up` |
| Use the dashboard that's already running on a different machine. | `kronos agent --no-server` |
| Quick onboarding with token + alias. | `kronos setup` |
| Dev-server only (production mode: `bun run start`). | `kronos serve` |
| HMR workflow during frontend development. | `kronos serve --dev` |
| Tear down the in-process dev server. | `kronos down` |

## Commands

```bash
# Launch the TUI setup wizard
kronos setup

# Save token and optional server base URL (non-interactive).
# Defaults to http://localhost:3737 (override via KRONOS_PORT or --port <n>).
kronos login --token <token> --server http://localhost:3737

# Start stdio ACP bridge from any ACP NDJSON source
<acp-server-command> | kronos watch-stdio --alias my-agent --token <token>

# Drive an ACP server command from watch-stdio (auto-loads pending task for alias)
kronos watch-stdio --alias my-agent --token <token> --drive-acp --agent "<acp-server-command>" --server http://localhost:3737

# Persistent queue consumer (no external while loop)
kronos agent --alias my-agent --token <token> --agent "<acp-server-command>" --server http://localhost:3737 --poll-ms 3000

# Force legacy polling transport (kronos agent defaults to streamable-http)
kronos agent --alias my-agent --token <token> --agent "<acp-server-command>" --queue-transport polling --poll-ms 3000

# Disable @mention path autocompletion preprocessor
kronos agent --alias my-agent --token <token> --agent "<acp-server-command>" --no-mention-preprocess

# Use a non-default port without editing config
kronos agent --alias my-agent --port 8080
KRONOS_PORT=8080 kronos up
```

## Standalone Binary

You can compile the CLI into a single `.exe` / binary so users don't need
Node, bun, or even the Kronos checkout on `$PATH`:

```bash
# Cross-platform scripts via npm
bun run build:bin                   # current platform, -> ./kronos.exe (or kronos)
bun run build:bin:win               # kronos.exe (Windows x64)
bun run build:bin:macos:arm64       # kronos (Apple Silicon)
bun run build:bin:macos:x64         # kronos (Intel Mac)
bun run build:bin:linux:x64         # kronos (Linux x64)
```

Then copy the resulting binary to anywhere on `$PATH` and call it directly:

```bash
kronos setup
kronos agent
```

The binary bundles `@clack/prompts` and `@agentclientprotocol/sdk`. The only
native dependency (`better-sqlite3`) is **lazy-loaded** only when `--db-path`
is passed — if a user invokes a `--db-path` command under the bun-compiled
binary they get a clear error telling them to use the Node CLI.

## npm Scripts

```jsonc
{
  "kronos": "node ./cli/kronos.js",          // ->  npx kronos ...
  "setup":  "node ./cli/kronos.js setup",    // ->  npm run setup
  "build:bin": "bun build --compile ..."     // ->  single-file executable
}
```

The legacy `agent` script was removed — use `kronos agent` (the canonical CLI
subcommand) instead.

## Behavior

- Forwards normalized lifecycle events to `POST /api/acp/events`.
- Buffers outbound events in memory and retries with exponential backoff.
- Supports mid-session attach by emitting a synthetic `session/new` when first observed event is non-start.
- `watch-stdio` consumes newline-delimited JSON from stdin (ACP stdio stream).
- `watch-stdio --drive-acp` runs a built-in ACP client loop (`initialize -> session/new -> session/prompt`) against the `--agent` command and forwards lifecycle events through the same queue/retry path.
- `--drive-acp` uses the latest active task body for the given alias from `prisma/dev.db`; no `--prompt` flag is required.
- `kronos agent` keeps running and repeatedly consumes newly scheduled tasks for the alias.
- `kronos agent` defaults to `streamable-http` via `GET /api/bridge/tasks` and falls back to polling when `--queue-transport polling` is set.
- `kronos agent` and `watch-stdio --drive-acp` preprocess `@...` mentions in task text, autocomplete to project file paths, and append a resolution summary to the prompt (`--no-mention-preprocess` to disable).

## Bridge Endpoints (server-side)

The wizard talks to a small bridge-token-authenticated API:

| Endpoint | Use |
|---|---|
| `GET /api/bridge/agents?token=<bridge>` | List the caller's agent aliases (used by `setup` to populate the alias picker) |
| `POST /api/bridge/agents` (body: `{ alias, name, agentType, connectionTier, ... }`, `Authorization: Bearer <bridge>`) | Idempotently register an alias from the CLI; existing aliases return as-is so re-running `setup` is safe |
| `GET /api/bridge/tasks?alias=&token=` | Streamable-HTTP queue delivery (`kronos agent` default transport) |
| `POST /api/acp/events` | Lifecycle event ingestion |

The bridge token never expires the user's session — it is a separate HMAC-signed
JWT that exists only to authenticate the CLI to the user's resources.

## Auth

- App users can mint a bridge token via `POST /api/bridge/token` while authenticated.
- Token source order:
  1. `--token`
  2. value saved by `kronos login`
  3. value saved by the `kronos setup` wizard
