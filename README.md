# pi-durable-rpc-harness

A **pi-RPC-compatible harness** whose execution engine is [`@earendil-works/pi-durable`](https://github.com/earendil-works/pi). It speaks pi's RPC protocol (JSONL commands/events on stdin/stdout) so an existing pi RPC client can drive it as a drop-in for `pi --mode rpc`, while conversations, tasks, and documents are committed durably and can be stored in **PostgreSQL**.

```text
client  ──JSONL──►  harness (this repo)  ──►  Pi Durable Harness  ──►  Storage
        ◄─events──                      commands ⇄ Conversation/Task/Document
                                                             Memory │ SQLite │ PostgreSQL
```

Design and requirements live in the archived OpenSpec change [`2026-10-08-durable-rpc-harness`](openspec/changes/archive/2026-10-08-durable-rpc-harness/); main specs are under [`openspec/specs/`](openspec/specs/).

---

## Requirements

- **Node.js >= 22.19** (the floor shared by every `@earendil-works/*` package; durable's SQLite backend uses `node:sqlite`).
- Optional: a PostgreSQL server for the Postgres storage backend.

## Install and build

```bash
npm install          # exact-pinned dependencies
npm run build        # tsc -> dist/  (the supported release artifact)
npm run build:bundle # optional single-file ESM bundle -> dist/bundle/cli.js
npm run check        # typecheck + build + tests (76 tests)
```

Run:

```bash
node dist/cli.js --help
# or the bundled artifact
node dist/bundle/cli.js --help
```

The package is private; a compiled single-executable (Node SEA) is intentionally not shipped — see [Limitations](#limitations).

## Quick start (RPC)

```bash
printf '{"id":"1","type":"get_state"}\n{"id":"2","type":"prompt","message":"List the files"}\n' \
  | node dist/cli.js --no-session
```

Records are one compact JSON object per LF-terminated line. Commands carry an optional `id`; the matching response repeats it. Session events stream to stdout; diagnostics go to stderr. See [docs/rpc.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) for the protocol.

## Full example: podman + PostgreSQL

A complete run against a containerized PostgreSQL, including a restart that proves the conversation is durable.

**1. Start PostgreSQL** (podman; any Postgres works):

```bash
podman run -d --name harness-pg \
  -e POSTGRES_PASSWORD=harness -e POSTGRES_USER=harness -e POSTGRES_DB=harness \
  -p 127.0.0.1:55432:5432 docker.io/library/postgres:17-alpine

# wait until it accepts connections
until pg_isready -h 127.0.0.1 -p 55432 -U harness; do sleep 1; done
```

**2. Build the harness:**

```bash
npm install && npm run build
```

**3. Point it at PostgreSQL** (unset this variable to fall back to local SQLite):

```bash
export PI_DURABLE_DATABASE_URL='postgres://harness:harness@127.0.0.1:55432/harness'
```

**4. First run — a new session `demo` and one prompt.**
`tools/rpc-call.mjs` is a small external RPC client: everything before `--` is passed to the harness, everything after is sent as commands; it exits when the run settles.

```bash
node tools/rpc-call.mjs --session-id demo -- \
  '{"type":"get_state"}' \
  '{"type":"prompt","message":"Reply with exactly one word: OK"}'
```

```json
{"id":"c1","type":"response","command":"get_state","success":true,"data":{"model":{"provider":"litellm","id":"deepseek-v4-1-flash"},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"all","followUpMode":"one-at-a-time","sessionId":"demo","sessionFile":null,"autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
{"id":"c2","type":"response","command":"prompt","success":true,"data":{"disposition":"started"}}
{"type":"agent_settled"}
```

**5. Reopen the same session — the conversation is still there:**

```bash
node tools/rpc-call.mjs --session-id demo -- \
  '{"type":"get_state"}' '{"type":"get_entries"}'
```

```json
{"command":"get_state","success":true,"data":{ … "sessionId":"demo", "messageCount":3 … }}
{"command":"get_entries","success":true,"data":{"entries":[{…"type":"message"…},{…"type":"custom"…},{…"type":"message"…}],"leafId":"11"}}
```

**6. Inspect the database.** Each session is one schema, `s_<slug>_<hash-of-key>`:

```bash
podman exec harness-pg psql -U harness -d harness -c \
  "SELECT table_schema FROM information_schema.tables WHERE table_name='entries' AND table_schema LIKE 's_%';"

podman exec harness-pg psql -U harness -d harness -c \
  "SELECT id, (record::jsonb)->>'kind' AS kind FROM s_demo_2a97516c354b.entries ORDER BY id;"
```

```text
   table_schema
----------------------
 s_demo_2a97516c354b

 id |     kind
----+--------------
  7 | pi.user
 10 | pi.system
 11 | pi.assistant
```

**7. Restart the database and reopen** — durable storage survives:

```bash
podman restart harness-pg
until pg_isready -h 127.0.0.1 -p 55432 -U harness; do sleep 1; done

node tools/rpc-call.mjs --session-id demo -- '{"type":"get_state"}'
# … "sessionId":"demo", "messageCount":3 …
```

**Cleanup:**

```bash
podman rm -f harness-pg
```

Notes:

- The **session key** (`--session-id demo`, `--session`, or `-n/--name`) selects the schema, so the same key resumes the same conversation from any working directory; the working directory only picks the default key when none is given.
- Without `--session-id`, the key defaults to the working directory name, so two different folders get two different sessions.
- While one process holds a session, a second process opening the same key is refused (`pg_advisory_lock`); `--no-session` uses in-memory storage and ignores PostgreSQL.

## Startup contract

The harness is configured **through pi's CLI flags and environment variables only** — no extra handshake, socket, or protocol extension.

Flags it acts on (other pi flags are parsed and ignored so a client can pass pi's full argument list):

| Flag | Meaning |
| --- | --- |
| `--mode rpc` | Accepted; the harness serves RPC only |
| `--session-id <id>` / `--session <id>` / `-n, --name <name>` | Session key (selects the durable session) |
| `-c, --continue` | Continue the session for the working directory |
| `--no-session` | Ephemeral in-memory session |
| `--session-dir <dir>` | Directory for local SQLite sessions |
| `--provider <name>` / `--model <pattern>` / `--thinking <level>` | Initial model / thinking level |
| `--offline` / `-h, --help` | Offline mode / usage |

Environment variables:

| Variable | Effect |
| --- | --- |
| `PI_DURABLE_DATABASE_URL` | PostgreSQL URL. When set, storage is PostgreSQL; otherwise SQLite under `--session-dir`. |
| `PI_CODING_AGENT_DIR` | Config directory (default `~/.pi/agent`); tilde is expanded. |
| `PI_CODING_AGENT_SESSION_DIR` | Overrides the local session directory. |
| `PI_OFFLINE` | Disables automatic network activity. |
| Provider API-key variables / `auth.json` | Credentials (read by pi's model runtime). |

## pi configuration files it reads

The harness reuses pi's own loaders, so **the standard pi configuration is read**:

| File | Read by | Notes |
| --- | --- | --- |
| `$PI_CODING_AGENT_DIR/models.json` (default `~/.pi/agent/models.json`) | `ModelRuntime.create()` | Custom providers/models. `ModelRuntime` defaults `modelsPath` to `<agentDir>/models.json`. |
| `$PI_CODING_AGENT_DIR/auth.json` | `ModelRuntime` credential store | API keys / OAuth tokens. |
| `$PI_CODING_AGENT_DIR/models-store.json` | `ModelRuntime` | Catalog cache. |
| `$PI_CODING_AGENT_DIR/settings.json` | `SettingsManager.create(cwd)` | Global settings. |
| `<cwd>/.pi/settings.json` | `SettingsManager` | Project settings (merged over global). |
| `$PI_CODING_AGENT_DIR/mcp.json` and `<cwd>/.pi/mcp.json` | `loadMcpTools()` | MCP servers; project entries override global. |
| `AGENTS.md` (agent dir, parents, cwd) | `DefaultResourceLoader` | Project instructions → prompt section `project_context`. |
| `SYSTEM.md` | `DefaultResourceLoader` | Replaces/appends the system prompt → prompt section `system`. |
| `$PI_CODING_AGENT_DIR/skills/**` and discovered skills | `DefaultResourceLoader` | Rendered into the prompt via `formatSkillsForPrompt`. |

Settings that the harness reads live at every use (steering/follow-up mode, compaction, retry, stream timeouts), so a settings edit applies from the next use without a restart.

**Not loaded / not applied** (by design — extension packages are out of scope):

- pi **extension packages** (`extensions:`, `packages:`, `-e`): the loader runs with `noExtensions: true`. Built-in `codemode`, `tool_search`, and MCP are provided instead by this repo's own adapters.
- **Project trust** is not enforced: pi resolves project trust before loading project resources; this harness does not call that gate.
- **Themes** and **prompt templates** are discovered but not used (the RPC surface has no terminal or editor to apply them to).

## Storage

Storage is selected by configuration and is invisible to the client.

| Backend | When | Notes |
| --- | --- | --- |
| **PostgreSQL** | `PI_DURABLE_DATABASE_URL` set | One schema per session plus a catalog; a per-session `pg_advisory_lock` is the cross-process single writer. |
| **SQLite** | default | Local file at `<sessionDir>/<session-key>.sqlite`, via `node:sqlite`. |
| **Memory** | `--no-session` | Ephemeral. |

PostgreSQL reuses durable's portable `SqliteStorage` core over a facade (`src/storage/postgres/`): `?`→`$n`, `INTEGER`→`BIGINT`, `STRICT`/`json_valid` dropped, `INSERT OR IGNORE`→`ON CONFLICT DO NOTHING`; durable's own migrations run through the facade. It passes durable's storage conformance suite (25 cases) and behaves identically to `MemoryStorage` for a canonical script.

## Supported RPC commands

All of pi's RPC commands are accepted:

| Group | Commands |
| --- | --- |
| Prompting | `prompt`, `steer`, `follow_up`, `abort`, `clear_queue` |
| State | `get_state`, `get_messages`, `get_entries`, `get_tree`, `get_last_assistant_text`, `get_session_stats` |
| Model | `set_model`, `cycle_model`, `get_available_models` |
| Thinking | `set_thinking_level`, `cycle_thinking_level`, `get_available_thinking_levels` |
| Queue modes | `set_steering_mode`, `set_follow_up_mode` |
| Compaction / retry | `compact`, `set_auto_compaction`, `set_auto_retry`, `abort_retry` |
| Bash | `bash`, `abort_bash` |
| Sessions | `new_session`, `switch_session`, `fork`, `clone`, `get_fork_messages`, `set_session_name`, `export_html` |
| Discovery | `get_commands` |

Behavior matched to **pinned pi 1.1.0** (`test/fixtures/pi-1.1.0/`): malformed JSON is answered with a `success:false` response carrying no `command`/`id`; unknown commands are answered by name; `extension_ui_response` is ignored without ending the process; `get_state` reports the harness session id and a `null` session file (or omits it when ephemeral).

Events: `agent_start`, `turn_start`, `message_start`, `message_update` (one `assistantMessageEvent` per change), `message_end`, `tool_execution_start/update/end`, `turn_end`, `agent_end`, `queue_update`, `compaction_start/end`, `auto_retry_start/end`, `entry_appended`, `thinking_level_changed`, `bash_execution_update`, and `agent_settled` (synthesized when the session is quiescent). The internal durable `snapshot` is never forwarded; a fresh client primes from `get_state`/`get_messages`.

### Run policy

`set_steering_mode`, `set_follow_up_mode`, `set_auto_compaction`, and `set_auto_retry` are persisted as an append-only durable entry (`harness.policy`); the latest wins and `get_state` reflects it.

## Tools

| Tool | Source |
| --- | --- |
| `read`, `write`, `edit`, `bash` | durable's `CodingTools` |
| `find`, `grep`, `ls` | this repo (`src/tools/`), over the call's `ExecutionEnv` |
| `powershell` | durable, on Windows |
| `codemode` | `@earendil-works/pi-codemode` sandbox; composes the agent's tools as `tools.<name>(args)` |
| `tool_search` | searches the agent's available tools |
| `mcp__<server>__<tool>` | `@earendil-works/pi-mcp`; configured via `mcp.json` |

Shell tool commands receive pi's session metadata (`PI_SESSION_ID`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`) and the `AI_AGENT`/`PI_CODING_AGENT` markers.

## Transcript projection

Durable entries are canonical; a versioned adapter (`src/harness/projection.ts`) projects them to pi's session-entry shapes for `get_entries`, `get_tree`, and `export_html`. Control-plane transitions (model change, thinking level, session info, label) are recorded as an **append-only durable entry kind** so they project at their original position, and **unknown entry kinds are preserved verbatim**.

## Limitations

- **Extension UI** (`extension_ui_request/response`) is not implemented; inbound `extension_ui_response` records are ignored.
- **Third-party pi extension packages** are not loaded.
- **Project trust** is not enforced.
- **MCP exposure modes** are simplified: discovered tools are declared directly (no `deferred`/`codemode` activation).
- The `read` tool cannot read image files; image *input* in prompts is supported (mapped to content blocks).
- `find`/`grep`/`ls` are functionally equivalent to pi's, not byte-identical in formatting.
- **Single-executable (Node SEA) binary** is not shipped: it would require embedding the QuickJS wasm asset and postject injection. The supported artifacts are the ESM package and the JS bundle.
- Multi-writer commits to a single session are out of scope; a session has one writer (enforced by a PostgreSQL advisory lock).

## Testing

```bash
npm run check                                   # typecheck + build + tests (SQLite/unit)
TEST_DATABASE_URL=postgres://user:pass@host/db \
  npm run check                                 # adds PostgreSQL conformance + parity tests
node tools/capture-fixtures.mjs                 # re-capture golden pi RPC fixtures
PI_ACCEPT_PROMPT=1 node tools/acceptance.mjs    # drive the harness as an external client
```

PostgreSQL can be started locally, e.g.:

```bash
podman run -d --name harness-pg \
  -e POSTGRES_PASSWORD=harness -e POSTGRES_USER=harness -e POSTGRES_DB=harness \
  -p 127.0.0.1:55432:5432 docker.io/library/postgres:17-alpine
```

## Layout

```text
src/
  cli.ts                     entry: sets pi process markers, imports main
  index.ts                   resolve config, load resources, open engine, serve RPC
  process-markers.ts         AI_AGENT / PI_CODING_AGENT / process.title
  harness/
    config.ts                CLI + env startup contract
    settings.ts              HarnessSettings read live from pi settings
    prompt.ts                pi prompt sections (system, AGENTS.md, skills, cwd)
    engine.ts                durable Harness over SQLite/Postgres/ephemeral
    events.ts                durable watchEvents -> pi event projection
    projection.ts            S1 transcript projection, control/policy entries, HTML export
    input.ts                 image content -> durable content blocks
  rpc/
    framing.ts               LF-only JSONL reader/writer
    protocol.ts              RpcSession contract + response shapes
    server.ts                dispatch, correlation, event streaming
    session.ts               durable-backed RpcSession implementation
  storage/postgres/
    ddl.ts                   SQLite dialect -> PostgreSQL translation
    database.ts              SqliteDatabase facade over one PG connection
    storage.ts               open storage, advisory lock
  tools/
    index.ts                 ls/find/grep + platform shell + CodemodeTools extension
    codemode.ts              QuickJS sandbox tool
    tool-search.ts           tool discovery
    mcp.ts                   mcp.json -> MCP client -> durable tools
test/                        unit + conformance + parity + fixtures
tools/                       capture-fixtures.mjs, acceptance.mjs, rpc-call.mjs
scripts/                     check.mjs, build-bundle.mjs
```

## References

- RPC protocol: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md>
- Pi Durable: <https://github.com/earendil-works/pi/tree/main/packages/durable>
- Session format: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md>
- This change: [`openspec/changes/archive/2026-10-08-durable-rpc-harness`](openspec/changes/archive/2026-10-08-durable-rpc-harness/)
