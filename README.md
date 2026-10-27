# pi-durable-rpc-harness

A **pi-RPC-compatible harness** whose execution engine is [`@earendil-works/pi-durable`](https://github.com/earendil-works/pi). It speaks pi's RPC protocol (JSONL commands/events on stdin/stdout) so an existing pi RPC client can drive it as a drop-in for `pi --mode rpc`, while conversations, tasks, and documents are committed durably and can be stored in **PostgreSQL**.

```text
client  ──JSONL──►  harness (this repo)  ──►  Pi Durable Harness  ──►  Storage
        ◄─events──                      commands ⇄ Conversation/Task/Document
                                                             Memory │ SQLite │ PostgreSQL
```

Design and requirements live in the archived OpenSpec changes: [`2026-10-08-durable-rpc-harness`](openspec/changes/archive/2026-10-08-durable-rpc-harness/) (the harness), [`2026-10-08-mcp-exposure-parity`](openspec/changes/archive/2026-10-08-mcp-exposure-parity/) (MCP exposure), and [`2026-10-27-pi-compat-skills-extensions`](openspec/changes/archive/2026-10-27-pi-compat-skills-extensions/) (pi 1.4.0 pin, skills, extensions); main specs are under [`openspec/specs/`](openspec/specs/).

---

## Requirements

- **Node.js >= 22.19** (the floor shared by every `@earendil-works/*` package; durable's SQLite backend uses `node:sqlite`).
- **pi `1.4.0`**, pinned exactly. The RPC wire surface and the golden fixtures in `test/fixtures/pi-1.4.0/` are captured from that release; parity claims apply to it.
- Optional: a PostgreSQL server for the Postgres storage backend.

## Install and build

```bash
npm install          # exact-pinned dependencies
npm run build        # tsc -> dist/  (the supported release artifact)
npm run build:bundle # optional single-file ESM bundle -> dist/bundle/cli.js
npm run check        # typecheck + build + tests (95 tests, 27 PostgreSQL tests skipped by default)
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

Or run a prompt in one shot, like `pi "do something"`:

```bash
node dist/cli.js "List the files"              # print the final answer, then exit
node dist/cli.js --mode json "List the files"   # session header, then JSONL events
node dist/cli.js --print "List the files"       # same as the first form
echo "context" | node dist/cli.js "Summarize"   # piped stdin prepends to the prompt
node dist/cli.js @notes.md "Review this"        # @file into the first prompt
```

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
| `message` (positional) | Run a prompt in one shot (print, or json with `--mode json`); rejected in RPC mode |
| `-p`, `--print` | One-shot: run the prompts, write the final answer text, then exit |
| `--mode json` | One-shot: write a session header and then JSONL events, then exit |
| `--mode text` (default) | One-shot print when a prompt is given |
| `--mode rpc` | Serve RPC on stdin; the default when no positional prompt is given |
| `--` | Stop option parsing, so a prompt may begin with `-` |
| `@path` | Include a text file or an image in the first prompt |
| piped stdin | Prepended to the first prompt when stdin is not a terminal |
| `--session-id <id>` / `--session <id>` / `-n, --name <name>` | Session key (selects the durable session) |
| `-c, --continue` | Continue the session for the working directory |
| `--no-session` | Ephemeral in-memory session |
| `--session-dir <dir>` | Directory for local SQLite sessions |
| `--provider <name>` / `--model <pattern>` / `--thinking <level>` | Initial model / thinking level |
| `--offline` / `-h, --help` | Offline mode / usage |

Without a positional prompt the harness serves RPC. A positional prompt selects a one-shot mode and the process exits `0` when the prompt is answered (non-zero otherwise). There is no interactive TUI: a terminal client uses RPC mode, so a prompt always runs one shot.

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

**Extensions and skills:**

- pi **extensions** (`extensions/`, `packages:`, `-e`) load through `DefaultResourceLoader` and are translated into durable tools and hooks. The hosted subset is `registerTool`, `context`/`context_with_system`, `tool_call`, `tool_result`, `session_before_compact`, `registerProvider`, `registerCommand`, and `session_before_fork`/`_switch`/`_tree`. Every other surface is reported by name on stderr at startup; nothing is silently dropped.
- **Skills** are listed by `get_commands` as `skill:<name>` and expanded from `/skill:<name> <args>` before the model call, as pi does. A `disable-model-invocation` skill stays command-invocable and is hidden from model selection.
- **Prompt templates** appear in `get_commands` with `source: "prompt"`.
- **Themes** are discovered but not used (the RPC surface has no terminal to apply them to).

Project resources are gated on trust: `AGENTS.md`, project skills, and other project resources load only when the project is trusted (`SettingsManager.isProjectTrusted()`), matching pi's order (trust, then project resources).

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
| Discovery | `get_commands` (extension commands, prompt templates, skills) |

Behavior matched to **pinned pi 1.4.0** (`test/fixtures/pi-1.4.0/`): malformed JSON is answered with a `success:false` response carrying no `command`/`id`; unknown commands are answered by name; `extension_ui_response` is ignored without ending the process; `get_state` reports the harness session id and a `null` session file (or omits it when ephemeral).

Events: `agent_start`, `turn_start`, `message_start`, `message_update` (one `assistantMessageEvent` per change), `message_end`, `tool_execution_start/update/end`, `turn_end`, `agent_end`, `queue_update`, `compaction_start/end`, `auto_retry_start/end`, `entry_appended`, `thinking_level_changed`, `bash_execution_update`, and `agent_settled` (synthesized when the session is quiescent). The internal durable `snapshot` is never forwarded; a fresh client primes from `get_state`/`get_messages`.

### Run policy

`set_steering_mode`, `set_follow_up_mode`, `set_auto_compaction`, and `set_auto_retry` are persisted as an append-only durable entry (`harness.policy`); the latest wins and `get_state` reflects it.

## Tools

Tool definitions use **pi's exact descriptions and parameter schemas** (execution stays durable's); the differential harness verifies the model request is identical to pi's.

| Tool | Source | Declared by default |
| --- | --- | --- |
| `read`, `bash`, `edit`, `write` | durable execution, pi's definitions | yes |
| `ls`, `find`, `grep` | this repo (`src/tools/`), over the call's `ExecutionEnv` | no — enable with `defaultTools` |
| `powershell` | durable, on Windows | on Windows |
| `codemode` | `@earendil-works/pi-codemode` sandbox; composes tools as `tools.<name>(args)` | only when activated |
| `tool_search` | searches tools that are not declared yet | only when activated |
| `mcp__<server>__<tool>` | `@earendil-works/pi-mcp`, per `mcp.json` | per exposure (below) |
| `read_mcp_resource` | MCP resources | per exposure |
| extension tools | pi extensions' `registerTool`, translated to durable tools (`src/extensions/`) | yes, when the extension is loaded |

`codemode` and `tool_search` are activated automatically when a configured MCP server needs them (see below), or forced with the `defaultTools` setting (`["+codemode", "+tool_search"]`).

### MCP tool exposure

`mcp.json` is read from `$PI_CODING_AGENT_DIR/mcp.json` and `<cwd>/.pi/mcp.json`; a project entry without a transport overrides only `enabled`, `exposure`, and `toolExposure` of the global server of the same name. A server's `exposure` defaults to `codemode`; `toolExposure` overrides single tools (an exact name wins over a pattern; the first matching pattern wins). The exposures behave exactly as in pi:

| Exposure | Declared to the model? | Reached through |
| --- | --- | --- |
| `direct` | yes | callable from codemode scripts |
| `model-only` | yes | not callable |
| `codemode` | no | codemode scripts |
| `codemode-deferred` | no | codemode scripts (`tool_search` also loads it) |
| `deferred` | no, until loaded | `tool_search`, then called directly |
| `hidden` | no | only when listed in `toolExposure` |

`tool_search` declares its matches by returning `control.addTools`, so they are declared from the next request and recorded in the transcript. `autoEnableCodemode: false` in `mcp.json` suppresses the codemode activation. A `mcp_servers` prompt section lists the codemode and deferred servers with how to reach them.

Shell tool commands receive pi's session metadata (`PI_SESSION_ID`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`) and the `AI_AGENT`/`PI_CODING_AGENT` markers.

## Transcript projection

Durable entries are canonical; a versioned adapter (`src/harness/projection.ts`) projects them to pi's session-entry shapes for `get_entries`, `get_tree`, and `export_html`. Control-plane transitions (model change, thinking level, session info, label) are recorded as an **append-only durable entry kind** so they project at their original position, and **unknown entry kinds are preserved verbatim**.

## Limitations

- **Extension UI** (`extension_ui_request/response`) is not implemented; inbound `extension_ui_response` records are ignored, and `ctx.ui.*` calls in a hosted extension are inert.
- **Extension surfaces outside the hosted subset** are reported on stderr and not applied: observation-only events (`agent_start`, `turn_start`, `message_*`, `session_start`, `model_select`, ...), renderer registrations, flags, shortcuts, `before_provider_request`, and `after_provider_response`.
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
npm run differential                            # diff the model request against pi (mock model + MCP fixture)
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
    system-prompt.ts         port of pi's system-prompt section builder
    pi-internals.ts          access to pi's codemode description composer
    prompt.ts                pi prompt sections (system, AGENTS.md, skills, cwd, mcp_servers)
    skills.ts                skills as RPC commands, /skill:<name> expansion
    engine.ts                durable Harness over SQLite/Postgres/ephemeral
    events.ts                durable watchEvents -> pi event projection
    projection.ts            S1 transcript projection, control/policy entries, HTML export
    input.ts                 image content -> durable content blocks
  extensions/
    host.ts                  pi extension -> durable tools/hooks, capability classifier, diagnostics
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
    pi-definitions.ts        pi's exact tool descriptions, schemas, and contributions
    exposure.ts              mcp.json merge, exposure resolution, declared/callable predicates
    state.ts                 process-wide exposure table
    activate.ts              activation + declared-set computation
    index.ts                 ls/find/grep + platform shell + PiCodingTools/CodemodeTools
    codemode.ts              QuickJS sandbox tool + composed description
    tool-search.ts           tool discovery (addTools)
    mcp.ts                   mcp.json -> MCP client -> durable tools + resources
test/                        unit + conformance + parity + fixtures
tools/                       capture-fixtures.mjs, acceptance.mjs, rpc-call.mjs,
                             differential-mcp.mjs, fake-mcp-server.mjs
scripts/                     check.mjs, build-bundle.mjs
```

## References

- RPC protocol: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md>
- Pi Durable: <https://github.com/earendil-works/pi/tree/main/packages/durable>
- Session format: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md>
- This change: [`openspec/changes/archive/2026-10-08-durable-rpc-harness`](openspec/changes/archive/2026-10-08-durable-rpc-harness/) (the harness)
- MCP exposure parity: [`openspec/changes/archive/2026-10-08-mcp-exposure-parity`](openspec/changes/archive/2026-10-08-mcp-exposure-parity/)
- pi 1.4.0 pin, skills, and extensions: [`openspec/changes/archive/2026-10-27-pi-compat-skills-extensions`](openspec/changes/archive/2026-10-27-pi-compat-skills-extensions/)
