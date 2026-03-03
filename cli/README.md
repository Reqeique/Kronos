# Kronos CLI Bridge

## Commands

```bash
# Save token and optional server base URL
Kronos login --token <token> --server http://localhost:3000

# Start stdio ACP bridge from any ACP NDJSON source
<acp-server-command> | Kronos watch-stdio --alias my-agent --token <token>

# Drive an ACP server command from watch-stdio (auto-loads pending task for alias)
Kronos watch-stdio --alias my-agent --token <token> --drive-acp --agent "<acp-server-command>" --server http://localhost:3000

# Persistent queue consumer (no external while loop)
Kronos watch-queue --alias my-agent --token <token> --agent "<acp-server-command>" --server http://localhost:3000 --poll-ms 3000

# Force legacy polling transport (watch-queue defaults to streamable-http)
Kronos watch-queue --alias my-agent --token <token> --agent "<acp-server-command>" --queue-transport polling --poll-ms 3000

# Disable @mention path autocompletion preprocessor
Kronos watch-queue --alias my-agent --token <token> --agent "<acp-server-command>" --no-mention-preprocess
```

## Behavior

- Forwards normalized lifecycle events to `POST /api/acp/events`.
- Buffers outbound events in memory and retries with exponential backoff.
- Supports mid-session attach by emitting a synthetic `session/new` when first observed event is non-start.
- `watch-stdio` consumes newline-delimited JSON from stdin (ACP stdio stream).
- `watch-stdio --drive-acp` runs a built-in ACP client loop (`initialize -> session/new -> session/prompt`) against the `--agent` command and forwards lifecycle events through the same queue/retry path.
- `--drive-acp` uses the latest active task body for the given alias from `prisma/dev.db`; no `--prompt` flag is required.
- `watch-queue` keeps running and repeatedly consumes newly scheduled tasks for the alias.
- `watch-queue` defaults to `streamable-http` via `GET /api/bridge/tasks` and falls back to polling when `--queue-transport polling` is set.
- `watch-queue` and `watch-stdio --drive-acp` preprocess `@...` mentions in task text, autocomplete to project file paths, and append a resolution summary to the prompt (`--no-mention-preprocess` to disable).

## Auth

- App users can mint a bridge token via `POST /api/bridge/token` while authenticated.
- Token source order:
  1. `--token`
  2. value saved by `Kronos login`
