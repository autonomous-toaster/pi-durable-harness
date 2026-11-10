## Why

The harness pins every `@earendil-works/*` package to pi `1.4.0`, while the installed pi CLI is `1.5.2`. The RPC event layer is built on `watchEvents()` and `AgentEvent`, which pi `1.5.0` removed. A `1.5.2` client therefore drives a server frozen on a deleted API, and the "drop-in for `pi --mode rpc`" claim no longer holds.

## What Changes

- Bump all six `@earendil-works/*` dependencies from `1.4.0` to `1.5.2` and re-capture the golden fixtures from `1.5.2`. **BREAKING**: no compatibility with `1.4.0` is kept.
- **BREAKING** Replace the event projection source. `watchEvents()`/`AgentEvent` are gone. Attach a synchronous `Harness.observeConversation()` observer, queue each revision, and translate its JSON-diff `ops` into pi's RPC records. Per-change granularity is preserved because synchronous observers deliver every change unfolded.
- Replace `Conversation.viewState()` (removed) in `engine.view()` with one-shot `Session.doc(InboxDoc, …)` and `Session.doc(LiveDoc, …)` reads, and count `get_state.messageCount` over the full history, not the windowed view.
- **BREAKING** Move tool parameter schemas from the removed `Type` export of `@earendil-works/pi-ai` to `@earendil-works/pi-schema` builders. Argument coercion and validation messages follow pi-schema.
- Add `runCounted()` to the PostgreSQL `SqliteExecutor` facade, which pi-durable `1.5.2` now calls.
- Make the deferred-progress window configurable through `PI_DURABLE_PERSIST_WITHIN_MS`, default `0` (store each partial immediately). The `1.5.2` default of `1000` ms would let a crash lose about one second of streamed output.
- Re-baseline the parity fixtures at `test/fixtures/pi-1.5.2/` and add an event fixture, so the event projection is tested instead of assumed.
- Document the one-way migration: conversations written under `1.5.2` (document version 3) cannot be read by `1.4.0`.

Explicit non-goals: backward compatibility with `1.4.0`; a rollback path; the `extension_ui_request`/`response` sub-protocol.

The client-facing record shapes in `rpc-parity` stay unchanged, so its event requirements take no delta. The derivation guarantees that keep them unchanged live in `event-projection`; only the state reads and the transcript count change.

## Capabilities

### New Capabilities

- `event-projection`: the observer attachment, the JSON-diff path router, the RPC record translation, and the settle synthesis.

### Modified Capabilities

- `harness-tooling-parity`: the pinned version, the fixture re-capture, and the tool definition source move to `1.5.2` and pi-schema.
- `rpc-parity`: state reads take the built-in documents through Session document reads and count the full transcript.
- `durable-storage-postgres`: the facade implements `runCounted()` and the batched `commit()` contract.
- `cli-prompt-modes`: startup reads `PI_DURABLE_PERSIST_WITHIN_MS` and applies it to the deferred-progress window.

## Impact

- **Code**: `src/harness/events.ts` (rewrite), `src/harness/engine.ts` (observer attach, `view()`), `src/harness/oneshot.ts`, `src/rpc/session.ts` (event start, `get_state`), `src/tools/index.ts`, `src/tools/mcp.ts`, `src/tools/tool-search.ts` (pi-schema), `src/storage/postgres/database.ts` (`runCounted`), `src/harness/settings.ts` and `src/harness/config.ts` (progress window).
- **Dependencies**: six packages `1.4.0` → `1.5.2`; `@earendil-works/pi-schema` becomes a direct dependency; `typebox` drops out of the harness's own imports.
- **Verification**: re-capture `test/fixtures/pi-1.5.2/`, add `events.ndjson`, and test the projector against it. Re-run the differential model-request diff and the PostgreSQL conformance suite.
- **Risk**: the op-path→record table is inferred from the changelog and the type surface. Rows for `message_start`/`message_end` and `turn_start`/`turn_end` must be confirmed against the captured event fixture before the rewrite is called done.
- **Rollback**: none. A `1.5.2` write stores documents at version 3.
