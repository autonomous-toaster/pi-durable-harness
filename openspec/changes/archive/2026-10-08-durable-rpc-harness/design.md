## Context

See `proposal.md` for motivation. The harness must be a transparent drop-in for `pi --mode rpc`: same CLI/env startup, same JSONL command/response/event contract, same observable model/tool/skill loading. The execution engine is `@earendil-works/pi-durable`, whose building blocks are Conversations of immutable Entries, durable Tasks, Chord-tracked Documents, Submissions, and a pluggable `Storage` interface (memory/JSONL/SQLite today). Durable's `Storage` and agent-event (`watchEvents`) APIs are marked experimental.

Two prior explorations established the constraints: an external client drives pi over raw pi-RPC NDJSON and today sends only `prompt` and `abort`; and coding-agent already contains a working durable coding agent (`packages/coding-agent/src/experimental/durable/`) that reuses pi's model runtime, settings, prompt/skills, and HTTP dispatcher. The RPC extension-UI subprotocol is explicitly out of scope.

## Goals / Non-Goals

**Goals:**
- Serve pi's full RPC command and event surface from a durable engine, with no client changes.
- Reuse pi's loading paths (model runtime, auth, settings, trust, prompt, skills, export-html) so loading behavior matches.
- Persist to PostgreSQL behind durable's `Storage` interface, selectable via configuration.
- Make parity falsifiable against real pi via conformance and golden-fixture tests.

**Non-Goals:**
- The RPC extension-UI subprotocol (`extension_ui_request`/`response`).
- The interactive TUI and non-RPC CLI modes (print/JSON) for this change.
- Multi-writer commits to one Session; multi-tenant hosting.
- Replacing pi's `AgentSession` inside the shipped `pi` binary.

## Decisions

### D1: Engine is the durable Harness (not pi's AgentSession)
Build the agent loop on `Harness`/`Conversation`, reusing coding-agent's `experimental/durable` setup (`harness-setup.ts`, `prompt.ts`, `runtime.ts`) as the starting point. Alternatives: (R1) keep `AgentSession` and swap `SessionManager` — rejected because `SessionManager` is a concrete, synchronous file store with no storage seam and no durable mid-turn resume; (R3) run vanilla pi and mirror to durable — rejected because a durable journal is not durable execution.

### D2: Thin RPC façade, ported types
Implement an RPC server that maps commands to durable operations and durable `watchEvents` to pi events. Reuse pi's exported types and loading modules rather than re-deriving them. The durable runtime's controller surface (`submit`, `compact`, `abort`, `setModel`, `cycleThinking`, `switchConversation`) already corresponds closely to RPC commands, so the façade is primarily a translation and state-read layer. Error behavior is matched to the pinned pi release, not to older documentation: the captured corpus (`test/fixtures/pi-1.1.0`) is authoritative. For example, pi answers malformed JSON with a `success: false` response carrying no `command` and no `id`.

### D3: Canonical transcript is durable (S1), with a control-plane log
Durable entries remain the source of truth; a versioned projection adapter produces pi `SessionEntry` shapes on read. To keep projection lossless, model changes, thinking-level changes, session info, and labels are recorded as an **append-only control-plane history** rather than inferred from current-state Documents, and unrecognized entry kinds are preserved verbatim. This was validated independently: a nine-member council converged on S1 with the control-plane-log precondition, and a TypeSafe/Jev judgment returned S1 with probability 1.00 (`jev-1.13.0`), control-plane history required 0.91, S2 unknown-kind/migration risk 0.89, conformance testing critical 0.86, and control-log priority 1.99/2 ("land with the entry projection").
Alternative (S2, store pi-shaped entries as durable entries) was rejected because it welds an externally-owned, independently versioned schema into durable's storage and generation task, turning pi format changes into data migrations.

### D4: Event projection and settle detection
A projector converts durable `watchEvents` batches into pi's individual event records: `run_start`/`run_end` → `agent_start`/`agent_end` (enriching `messages`/`willRetry`), `message_update.changes[]` → per-change pi `assistantMessageEvent`, `message_end.entry` → `message_end.message`, tool `output` deltas → `partialResult`, `tool_execution_end.entry` → result + error indicator, `inbox_update` → `queue_update`, and enriched `compaction_end`/retry families. `agent_settled` is synthesized from durability quiescence (no running tasks, no queued follow-ups, no retries). The internal `snapshot` event is never forwarded; a fresh client primes via `get_state`/`get_messages`, matching pi's late-join semantics. This is the highest-risk area and is covered by differential tests.

### D5: PostgreSQL storage mirrors the SQLite contract
PostgreSQL support reuses durable's portable `SqliteStorage` core over a PostgreSQL facade implementing the exported `SqliteDatabase` interface, rather than reimplementing `Storage`. A dialect module rewrites the portable dialect into PostgreSQL's: `?` bindings to `$n`, `INTEGER` to `BIGINT` (SQLite integers are 64-bit and minted ids exceed PG `integer`), `STRICT` and `json_valid(...)` dropped, and `INSERT OR IGNORE` to `ON CONFLICT DO NOTHING`. `SqliteStorage.open()` runs durable's own migrations through the facade, so the schema stays owned by durable and cannot drift. The shared `next_id`/`next_seq` metadata counters are kept instead of a `SEQUENCE`, because the portable core reads and writes them. Each session maps to one PostgreSQL schema plus a catalog, and a per-session `pg_advisory_lock` provides the cross-process single writer that SQLite got from file locking. Durable's storage conformance suite is the acceptance gate. Alternatives: reimplement `Storage` by hand (rejected — duplicates a pinned core and risks silent divergence); reuse SQLite in-VM (rejected — no shared store); `LISTEN/NOTIFY` (unnecessary while writes are single-writer).

### D6: Tooling parity via adapters over shared packages
Port the missing built-in tools (`find`, `grep`, `ls`, and the platform shell variant) onto durable's `defineTool`, wrapping pi's implementations. Adapt `codemode`, `tool_search`, and MCP onto durable's extension model, reusing the shared `@earendil-works/pi-codemode` and `@earendil-works/pi-mcp` packages. Reuse coding-agent's `ModelRuntime`, `SettingsManager`, trust resolution, and `prompt.ts` for model/tool/skill loading parity.

### D7: Per-session mutable run policy and a command registry
Because durable settings are read-only getters, per-session overrides for auto-compaction, auto-retry, steering mode, and follow-up mode are stored in a durable Document and consulted at each use. `get_commands` is backed by a small durable-side command registry (durable's `Registry` has no command concept).

### D8: Transparency is the process contract
The harness accepts pi's CLI flags and environment variables and adds no handshake, socket, or protocol extension. Storage selection (SQLite vs PostgreSQL) is configuration and invisible to clients, so in-VM vs host deployment is not a code change.

### D9: Runtime and packaging
Ship as a Node ESM module (Node >= 22.19, matching every pi package) with pi's process-entry semantics (set `AI_AGENT=pi`, `PI_CODING_AGENT=true`, reserve stdout for protocol, send diagnostics to stderr). The package is private initially and publishable later. The optional compiled single-file binary is produced with a Node single-executable build, **not Bun**: Bun lacks `node:sqlite`, which durable's SQLite backend imports, and the stack relies on Node APIs (`undici`, `jiti`, `proper-lockfile`). A Node single-executable keeps the full backend set (SQLite and PostgreSQL). The compiled artifact must be validated for worker threads (the codemode worker) and native addons; if those cannot be embedded, the compiled artifact is dropped and the ESM package runs on the image's Node. Alternatives: Bun — rejected (no `node:sqlite`); Deno — rejected (same Node API dependencies).

### D10: PostgreSQL session isolation
The SQLite backend keeps one database file per session; PostgreSQL mirrors that isolation with one schema per session plus a catalog mapping session key to schema, cwd, and timestamps. A per-session advisory lock provides the cross-process single-writer guarantee (the analogue of the file lock).

### D11: Extension packages are out of scope
The harness supports the built-in tools, the `codemode`, `tool_search`, and MCP extensions, and skills. It does not load third-party pi extension packages (custom tools, commands, TUI hooks) in v1. `get_commands` therefore returns a minimal built-in set. Alternative: support the pi extension API — rejected as a large, open-ended surface with no requirement driving it.

### D12: Shell session environment
Commands run by the shell tools receive the current session metadata (session id, provider, model, reasoning level) plus the `AI_AGENT`/`PI_CODING_AGENT` markers, as pi injects, so shell behavior matches.

### D13: Image input
RPC `prompt`, `steer`, and `follow_up` image content maps to durable content blocks (`UserInput = UserMessage["content"]`, which admits `ImageContent`). The `read` tool reading image files remains unsupported and is the only image-related gap; unsupported image handling is not treated as a separate parity failure.

### D14: Session identity in responses
`get_state.sessionId` is the harness session key (the external identifier), not durable's internal provider identity. `get_state.sessionFile` is `null` for a database-backed session, because no file exists; for an ephemeral session the field is omitted, matching the pinned pi release, which omits it under `--no-session`. Clients that require a path are a known incompatibility.

## Risks / Trade-offs

- [Durable `Storage`/`watchEvents` are experimental and drift] → Pin versions; run durable's storage conformance suite and pi golden-fixture tests in CI so drift fails loudly.
- [`agent_settled` synthesized incorrectly breaks clients that end a stream on it] → Differential tests against real pi recording; treat the settle predicate as a first-class contract in `rpc-parity`.
- [Projection is lossy without control-plane history] → The append-only control-plane log lands with the entry projection (Jev priority 1.99/2), and unknown entry kinds are preserved verbatim.
- [Coupling to durable's built-in generation task] → Avoided by D3/S1; the generation task stays free of pi schema.
- [MCP/codemode port cost and extension-API mismatch] → Reuse pi-mcp/pi-codemode; keep the durable adapter thin and test against pi's MCP fixtures.
- [PostgreSQL single-writer limits a future multiplayer requirement] → Single-writer now; scale later by one worker per session, matching durable's model.
- [Full parity is a moving target] → Version the projection adapter by pi session format and record the pinned pi/durable versions with the test corpus.
- [Worker threads and native addons may not embed in a Node single-executable binary] → Validate the compiled artifact early; if embedding fails, ship the ESM package and run it on the image's Node.

## Migration Plan

Incremental, additive, no client changes:
1. PostgreSQL `Storage` backend green against the conformance suite.
2. RPC server core (framing, dispatch, correlation, `get_*` reads).
3. Event projector with `agent_settled`.
4. Transcript projection plus the control-plane log.
5. Remaining commands (queue modes, retry/compaction toggles, direct bash, session management).
6. Tooling/extensions (find/grep/ls, codemode, tool_search, MCP), then skills parity.
7. Transparency and conformance harness; run with an external pi RPC client as the acceptance client.

Rollback: the harness is additive and clients are unchanged; reverting to the SQLite backend or to `pi` is a configuration/launch change. S1 keeps durable entry kinds stable, so no stored-data migration is required to reverse the projection.

## Open Questions

- The exact pinned built-in tool inventory and pi/durable versions for the parity matrix can be fixed when the conformance corpus is assembled.
- Multiplayer/multi-writer timeline is deferred and does not change these specs or the task breakdown.
