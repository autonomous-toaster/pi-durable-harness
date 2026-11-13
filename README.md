# pi-durable-harness

A **pi-RPC-compatible harness** whose execution engine is [`@earendil-works/pi-durable`](https://github.com/earendil-works/pi). It speaks pi's RPC protocol (JSONL commands/events on stdin/stdout) so an existing pi RPC client can drive it as a drop-in for `pi --mode rpc`, while conversations, tasks, and documents are committed durably and can be stored in **PostgreSQL**.

```text
client  ──JSONL──►  harness (this repo)  ──►  Pi Durable Harness  ──►  Storage
        ◄─events──                      commands ⇄ Conversation/Task/Document
                                                             Memory │ SQLite │ PostgreSQL
```

Design and requirements live in the archived OpenSpec changes: [`2026-10-08-durable-rpc-harness`](openspec/changes/archive/2026-10-08-durable-rpc-harness/) (the harness), [`2026-10-08-mcp-exposure-parity`](openspec/changes/archive/2026-10-08-mcp-exposure-parity/) (MCP exposure), and [`2026-10-27-pi-compat-skills-extensions`](openspec/changes/archive/2026-10-27-pi-compat-skills-extensions/) (pi pin, skills, extensions), plus [`re-pin-pi-152`](openspec/changes/re-pin-pi-152/) (pi 1.5.2 re-pin and state-based event projection); main specs are under [`openspec/specs/`](openspec/specs/).

---

## Requirements

- **Node.js >= 22.19** (the floor shared by every `@earendil-works/*` package; durable's SQLite backend uses `node:sqlite`).
- **pi `1.5.2`**, pinned exactly. The RPC wire surface, the golden command fixtures, and the captured event stream in `test/fixtures/pi-1.5.2/` come from that release; parity claims apply to it. `@earendil-works/pi-schema` `1.5.2` is a direct dependency because pi `1.5.0` stopped exporting `Type` from `pi-ai`.
- Optional: a PostgreSQL server for the Postgres storage backend.

## Install and build

```bash
npm install          # exact-pinned dependencies
npm run build        # tsc -> dist/  (the supported release artifact)
npm run build:bundle # self-contained single-file ESM bundle -> dist/bundle/cli.js
npm run build:sea    # Node SEA executable -> dist/sea/pi-durable-harness
                     # (needs a SEA-capable Node: official builds yes, Homebrew no)
npm run check        # typecheck + build + tests (PostgreSQL tests skipped without TEST_DATABASE_URL)
```

Run:

```bash
node dist/cli.js --help
# or the self-contained bundle (no node_modules beside it)
node dist/bundle/cli.js --help
```

The package installs one command, **`pi-durable-harness`** (`bin` in `package.json`, running `dist/cli.js`), so `npm link` makes it available on `PATH`. Diagnostics it writes to stderr are prefixed with the same name.

The package is private. Three artifacts are supported: the ESM package (`dist/`), one JavaScript file (`dist/bundle/cli.js`) that runs anywhere Node does with no `node_modules` beside it, and a single Node SEA executable (`dist/sea/pi-durable-harness`) that needs no Node installed. See [Limitations](#limitations) for what the SEA build gives up.

### The SEA executable

```bash
npx -y node@22.19.0 scripts/build-sea.mjs   # a shared Node cannot build one
./dist/sea/pi-durable-harness --help
```

Its argv belongs to the harness, not to Node, so a Node flag goes through the environment rather than after the executable:

```bash
NODE_OPTIONS=--trace-warnings ./dist/sea/pi-durable-harness --help
```

`--help` and a PostgreSQL session say nothing on stderr. A session on the SQLite backend prints Node's experimental-feature notice for `node:sqlite`; `NODE_OPTIONS=--no-warnings` silences it.

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
# A managed server: prove it with its CA and refuse anything unencrypted.
export PI_DURABLE_PG_SSL='verify-full'
export PI_DURABLE_PG_SSL_CA="$HOME/Downloads/ca.pem"
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

- The **session id** (`--session-id demo`, `--session demo`) is the whole identity, so the same id in two directories is two sessions and no directory can collide with another by name.
- With no session flag, a launch **starts a new session** with a fresh UUID. `-c` opens the most recently used session for the current tenant and working directory.
- `-n/--name` is a display name, never identity.
- `--tenant <name>` (default `default`) labels the session. The tenant is data: it names the container and, under PostgreSQL, a catalog row — no schema or table per tenant.
- Two sessions in one directory run at the same time: each is its own container. A second process opening the *same* session is refused (`pg_advisory_lock`); `--no-session` uses in-memory storage and ignores PostgreSQL.

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
| `--session-id <id>` / `--session <id>` | Open this session in this directory, or create it (pi's id rule) |
| `-c, --continue` | Open the newest session for this tenant and working directory |
| `-n, --name <name>` | Display name; not part of the identity |
| `--tenant <name>` | Tenant label (default `default`) |
| `--no-session` | Ephemeral in-memory session |
| `--skill <path>` | Load a skill file or directory (repeatable) |
| `--prompt-template <path>` | Load a prompt template file or directory (repeatable) |
| `--session-dir <dir>` | Directory for local SQLite sessions |
| `--provider <name>` / `--model <pattern>` / `--thinking <level>` | Initial model / thinking level |
| `--models <patterns>` | Comma-separated scope for startup and cycling (pi's own matcher) |
| `--api-key <key>` | Non-persistent key for the provider named by `--model`/`--models` |
| `--fork <id>` | Copy a session into a new one in this directory (`--session-id` names it) |
| `--offline` / `-h, --help` | Offline mode / usage |

Without a positional prompt the harness serves RPC. A positional prompt selects a one-shot mode and the process exits `0` when the prompt is answered (non-zero otherwise). There is no interactive TUI: a terminal client uses RPC mode, so a prompt always runs one shot.

Environment variables:

| Variable | Effect |
| --- | --- |
| `PI_DURABLE_DATABASE_URL` | PostgreSQL URL. When set, storage is PostgreSQL; otherwise SQLite under `--session-dir`. |
| `PI_DURABLE_PG_SCHEMA` | The one PostgreSQL schema every session opens inside (default `durable`). |
| `PI_DURABLE_PG_SSL` | `disable`, `require`, `verify-ca`, or `verify-full`. `require` encrypts; the `verify` modes also prove the server, which needs a CA. |
| `PI_DURABLE_PG_SSL_CA` | CA certificate in PEM, for `verify-ca` and `verify-full`. `~` expands. |
| `PI_DURABLE_PG_SSL_CERT` / `PI_DURABLE_PG_SSL_KEY` | Client certificate and key in PEM, for mutual TLS. Set both or neither. |
| `PI_DURABLE_PG_SSL_SERVERNAME` | The name the server certificate must carry, when it differs from the host in the URL. |
| `PI_DURABLE_PG_REQUIRE_SSL` | `1` refuses a connection that is not encrypted, even when the URL asked for none. |
| `PI_DURABLE_PERSIST_WITHIN_MS` | How long a deferred progress commit may stay in memory before it is stored. Default `0` (store each partial at once). A non-zero value batches streamed progress and loses up to that much on a crash. |
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

- pi **extensions** (`extensions/`, `packages:`, `-e`) load through `DefaultResourceLoader`; the harness reads what the loader recorded and applies it.
  - **Translated to durable**: `registerTool` → tools, `context`/`context_with_system` → a `beforeRequest` message hook, `tool_call`/`tool_result` → tool hooks, `session_before_compact` → a compaction hook.
  - **Dispatched from the session stream**: `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start/update/end`, `agent_before_settle`, `agent_settled`, `session_start`, `session_shutdown`, `session_compact`.
  - **Dispatched from the RPC commands**: `model_select`, `thinking_level_select`, `session_info_changed`, `session_tree`, `user_bash`, `input`, and the `session_before_switch/fork/tree` vetoes.
  - **Also applied**: `registerProvider` → the model runtime, `registerCommand` → the command registry, `registerFlag` → the process arguments, `resources_discover` → extra skill and template paths.
  - **Accepted with no effect, as in pi's own RPC mode**: entry/message/tool renderers, markdown transformers, shortcuts, and `ui_prompt_*` — they need a terminal.
  - **Reported on stderr**: only the surfaces with no seam — `project_trust`, `mcp_servers_change`, `cache_warming_decision`, `before_provider_request`, `before_provider_headers`, `after_provider_response`, and `provider_stream_event`. A handler result the harness cannot apply (such as `before_agent_start`'s `systemPrompt`) is reported too, never dropped silently.
- **Skills** are listed by `get_commands` as `skill:<name>` and expanded from `/skill:<name> <args>` before the model call, as pi does. A `disable-model-invocation` skill stays command-invocable and is hidden from model selection.
- **Prompt templates** appear in `get_commands` with `source: "prompt"`.
- **Themes** are discovered but not used (the RPC surface has no terminal to apply them to).

Project resources are gated on trust: `AGENTS.md`, project skills, and other project resources load only when the project is trusted (`SettingsManager.isProjectTrusted()`), matching pi's order (trust, then project resources).

## Storage

Storage is selected by configuration and is invisible to the client.

| Backend | When | Notes |
| --- | --- | --- |
| **PostgreSQL** | `PI_DURABLE_DATABASE_URL` set | One schema (`PI_DURABLE_PG_SCHEMA`) and one table set for every session — a `session` column plus a row-level-security policy, run as the `durable_scope` role so the policy is not bypassed — and a `harness_sessions` catalog holding `(tenant, cwd, session, last_used)` for `-c`. The `pg_advisory_lock` keys on schema and prefix, so two sessions open together and a second writer of one session is refused. |
| **SQLite** | default | One file per session at `<sessionDir>/<cwd>/<tenant>__<session>.sqlite`, via `node:sqlite`. The directory groups a working directory's sessions and the file's modification time answers `-c`. |
| **Memory** | `--no-session` | Ephemeral. |

PostgreSQL reuses durable's portable `SqliteStorage` core over a facade (`src/storage/postgres/`), so commit, scan, and document behavior is durable's, not a reimplementation. The dialect shim (`ddl.ts`) rewrites `?`→`$n`, `INTEGER`→`BIGINT`, drops `STRICT` and the `json_valid` checks, maps `INSERT OR IGNORE`→`ON CONFLICT DO NOTHING`, and translates the multi-row statements a `1.5.2` commit issues: `json_each(?)`→`json_array_elements(?::json)`, `json_extract(x.value, '$[n]')`→`(x.value #>> '{n}')` (with the `bigint` casts those comparisons need), and `INSERT … SELECT … FROM json_each(?)` expanded to a `VALUES` list of real bindings (`database.ts`), so each cell takes its column's type. Durable's own migrations run through the facade. It passes durable's storage conformance suite (32 cases) and behaves identically to `MemoryStorage` for a canonical script.

## The TUI

Run it with no mode and no prompt on a terminal:

```bash
npm run build:tui        # dist/ plus the pi-tui native helper for this platform
node dist/cli.js         # pi's own InteractiveMode, over durable state
```

The TUI is **pi's own interface code**, not a reimplementation: `dist/cli.js` hands pi's `InteractiveMode` a runtime served by the durable engine, so every row, selector, keybinding, and slash command is pi's. `--mode rpc` and a piped stdin keep the headless behaviour, and `--mode tui` forces the TUI on a non-terminal.

What is durable: the transcript, the session identity, the agent's model and thinking level, the active tool set, labels and custom entries, and the event stream the TUI renders. What is pi's: the layout, the editor, the selectors, the extension renderers, and the commands.

- The TUI is **not a single-file artifact**: `pi-tui` loads a native module from its own package, so the build needs the installed package tree. `npm run build:tui` proves the helper resolves.
- Extensions render through **pi's runner** — bound beside the durable host with the TUI's UI context — while execution stays on the durable host, so a hook runs once.
- Node flags go through the environment, as for the SEA binary: `NODE_OPTIONS=--trace-warnings node dist/cli.js`.

## Running under Open Terminal

Open Terminal starts the agent with `--mode rpc --session-id <id> --append-system-prompt <text|path>` and passes its configured command straight to `create_subprocess_exec`, so `OPEN_TERMINAL_PI_COMMAND` must be a **path to an executable file**, not a command line:

```sh
#!/bin/sh
exec node /opt/pi-durable-harness/dist/index.js "$@"
```

Set `PI_DURABLE_DATABASE_URL` to make a run survive a container restart: without it the session lives in SQLite under the workspace home, which the terminal reaps. Node >= 22.19 is required, and there is no single-executable build to copy — build the harness in the image.

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

Behavior matched to **pinned pi 1.5.2** (`test/fixtures/pi-1.5.2/`): malformed JSON is answered with a `success:false` response carrying no `command`/`id`; unknown commands are answered by name; `extension_ui_response` is ignored without ending the process; `get_state` reports the harness session id and a `null` session file (or omits it when ephemeral).

Events: `agent_start`, `turn_start`, `message_start`, `message_update` (one `assistantMessageEvent` per change, as `text`/`thinking`/`toolcall` `_start`, `_delta`, `_end`), `message_end`, `tool_execution_start/update/end`, `turn_end`, `agent_end`, `queue_update`, `compaction_start/end`, `auto_retry_start/end`, `entry_appended`, `thinking_level_changed`, `bash_execution_update`, and `agent_settled` (synthesized when the session is quiescent).

They are projected from durable state, not from an event log: `src/harness/events.ts` attaches a synchronous `Harness.observeConversation()` observer, records each revision into a queue (the observer may not await or call the session), drains it in order, and routes the revision's JSON-diff paths to records. A client attaching mid-run is primed from the acquisition value, so no snapshot is replayed and a fresh client still primes from `get_state`/`get_messages`. `entry_appended` is this harness's own record — pi's RPC client reads entries through `get_entries` — and the pinned event fixture is what the projection is tested against.

### Extension dialogs

An extension's `ctx.ui.select`, `confirm`, `input`, and `editor` reach an attached RPC client as pi's `extension_ui_request` records (`{type, id, method, title, ...}`) and resolve from the matching `extension_ui_response` (`value`, `confirmed`, or `cancelled`). `ctx.hasUI` is true only while an RPC client is attached, so a hosted extension takes its interactive branch in RPC mode and its fallback in print and json modes. `notify`, `setStatus`, `setWidget`, and `setTitle` stay inert: Open WebUI's adapter ignores them, and awaiting an answer that never comes would stall the tool.

A dialog belongs to the live connection. It settles cancelled when the run is aborted, when the client closes stdin, or at shutdown, and each request's `timeout` is honoured in milliseconds. It does **not** survive a reconnect or a process restart: a client that comes back finds the run aborted, not its unanswered question.

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
- **Provider-level extension hooks** are reported rather than applied: `before_provider_request`, `before_provider_headers`, `after_provider_response`, and `provider_stream_event`, because durable exposes the message list and the parsed message, not the provider payload or headers. `before_agent_start`'s `systemPrompt` and `message` results are reported the same way.
- The `read` tool cannot read image files; image *input* in prompts is supported (mapped to content blocks).
- `find`/`grep`/`ls` are functionally equivalent to pi's, not byte-identical in formatting.
- **The Node SEA build needs a SEA-capable Node.** A *shared* build — Homebrew's, for example — answers "Single executable application is disabled"; an official Node build works (`npx -y node@22.19.0 scripts/build-sea.mjs`). The SEA main is CommonJS, so `src/cli.ts` and `pi-internals.ts` carry no top-level await, and pi's codemode composer is loaded with `import.meta.url` defined, since CommonJS has none.
- **The SEA binary runs codemode inline.** A blob has no worker file to point at, so the sandbox falls back to the inline one with the wasm the blob carries. Its deadline is an interrupt budget rather than a timer: a script that computes without awaiting a tool is stopped by a poll count, not by wall-clock time.
- **The SEA binary is large** — about 122 MiB, because it is a copy of Node with a 17 MB payload.
- Multi-writer commits to a single session are out of scope; a session has one writer (enforced by a PostgreSQL advisory lock).
- A pending extension dialog does not survive a client reconnect or a process restart; it settles cancelled and the run aborts.
- **No rollback past 1.5.2.** Durable stores `pi.live` at document version 3, which pi-durable `1.4.0` cannot read. Take a database snapshot before the first `1.5.2` write if you might need to return to `1.4.0`.
- **Deferred progress trades durability for throughput.** A `PI_DURABLE_PERSIST_WITHIN_MS` above `0` batches streamed progress, so a crash loses up to that much of the running answer.

## Testing

```bash
npm run check                                   # typecheck + build + tests (SQLite/unit)
TEST_DATABASE_URL=postgres://user:pass@host/db \
  npm run check                                 # adds PostgreSQL conformance + parity tests
node tools/capture-fixtures.mjs                 # re-capture golden pi RPC fixtures
PI_ACCEPT_PROMPT=1 node tools/acceptance.mjs    # drive the harness as an external client
npm run differential                            # diff the model request against pi (mock model + MCP fixture)
TEST_LIVE_MODEL=1 node --test test/progress-window.test.mjs   # opt-in: progress window, live model
                                                # (TEST_LIVE_PROVIDER / TEST_LIVE_MODEL_ID override the model)
# test/event-fixture.test.mjs replays the pinned run against a mock model and
# compares the projected records with test/fixtures/pi-1.5.2/events.ndjson
```

Start PostgreSQL as in [Full example: podman + PostgreSQL](#full-example-podman--postgresql).

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
    events.ts                conversation observer + JSON-diff router -> pi event records
    projection.ts            S1 transcript projection, control/policy entries, HTML export
    input.ts                 image content -> durable content blocks
  extensions/
    host.ts                  pi extension -> durable tools/hooks, capability classifier, diagnostics
    events.ts                event dispatch to extension handlers, serialized
    actions.ts               durable-backed pi.* action surface + ctx.sessionManager
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
- pi pin, skills, and extensions: [`openspec/changes/archive/2026-10-27-pi-compat-skills-extensions`](openspec/changes/archive/2026-10-27-pi-compat-skills-extensions/)
- pi 1.5.2 re-pin and state-based event projection: [`openspec/changes/re-pin-pi-152`](openspec/changes/re-pin-pi-152/)
