# Durable RPC Harness

## Why

Clients drive Pi as a child process over the pi-RPC JSONL protocol, but pi's session persistence is local JSONL files: a crash mid-turn loses in-flight work and cannot resume it, and there is no shared durable store. We want a harness whose execution engine is `@earendil-works/pi-durable` (atomic commits, durable tasks, resumable runs) backed by PostgreSQL, while remaining a transparent drop-in for the `pi --mode rpc` process so existing clients need no change.

## What Changes

- Introduce a **pi-RPC-compatible harness**: a long-lived process that reads pi-RPC commands and writes responses/events as JSONL on stdin/stdout, with full parity across the command set, the event stream, framing, and stderr conventions.
- Use **Pi Durable** as the execution engine (Conversations, immutable Entries, durable Tasks, Chord documents) instead of pi's `AgentSession`/`SessionManager` loop.
- Reuse pi's client-facing loading behavior: model runtime, credentials, settings, project trust, the system prompt, tools, and skills must resolve the same way pi does so model/tool/skill selection has identical observable behavior.
- Add a **PostgreSQL backend** for Pi Durable's `Storage` interface (schema, migrations, cross-process single-writer locking, conformance), keeping storage selectable (memory/JSONL/SQLite/Postgres) behind the interface.
- Adopt **S1 (durable-canonical) transcript projection**: durable entries remain the source of truth; an adapter projects them into pi `SessionEntry` shapes for `get_entries`, `get_tree`, and `export_html`. To keep projection lossless, record control-plane transitions (model change, thinking level, session info, label) in an **append-only control-plane log**, and preserve unknown/future entry kinds verbatim.
- Bring **tooling to parity**: the built-in filesystem/shell tools and the `codemode`, `tool_search`, and MCP extensions, adapted onto Durable's extension model.
- Pin the **transparency contract**: the harness is launched with the same **CLI flags and environment variables** as pi; the process-level startup contract is the only integration surface.
- Support **image input** in prompts by mapping RPC image blocks to durable content blocks (durable's input type is `UserMessage["content"]`, which admits images).
- Package as a **Node ESM module** (Node >= 22.19) with pi's process-entry semantics; private first, publishable later; an optional compiled single-file binary is provided for constrained images.

Explicitly out of scope (non-goals): the RPC **extension-UI** subprotocol; the interactive TUI; third-party pi extension packages (tools, commands, TUI hooks); multi-writer concurrency to a single Session; multi-tenant hosting.

## Capabilities

### New Capabilities

- `rpc-parity`: the client-facing pi-RPC JSONL surface — commands, responses, session-event stream, framing, and the model/tool/skill loading behavior clients observe.
- `transcript-projection`: pi-shaped session reads (`get_entries`, `get_tree`, `export_html`) produced by projecting durable entries, with an append-only control-plane log and verbatim preservation of unknown entry kinds.
- `durable-storage-postgres`: a PostgreSQL implementation of Pi Durable's `Storage` interface that satisfies durable's atomicity, identity, scan, and document-revision contract.
- `harness-tooling-parity`: built-in tools, `codemode`, `tool_search`, and MCP exposed through the harness with parity to pi's tool set and skills loading.

### Modified Capabilities

- None. This is a new harness; it does not change requirements of existing specs.

## Impact

- **New code**: a harness package (RPC server, event projector, command dispatch, transcript projector), a Postgres storage backend, tool/extension adapters, and a packaging/binary build.
- **Dependencies**: `@earendil-works/pi-durable`, `@earendil-works/pi-ai`, `@earendil-works/chord`, `@earendil-works/pi-coding-agent` (model runtime, settings, auth, prompt/skills, export-html), `@earendil-works/pi-codemode`, `@earendil-works/pi-mcp`, `typebox`, and a PostgreSQL driver.
- **Systems**: clients are unchanged; the guest image/bridge launch path must supply the same CLI flags and environment variables it supplies pi today. Storage deployment (in-VM vs host) becomes a configuration choice, not a code change.
- **Risk**: Pi Durable's `Storage` and agent-event APIs are experimental and change without notice; pin versions and hold parity against golden pi fixtures so drift is detectable.
