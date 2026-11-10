## Context

See proposal.md - Why. The harness reuses pi's loaders (`ModelRuntime`, `SettingsManager`, `DefaultResourceLoader`) but runs durable's engine. Under `1.4.0` the RPC event stream came from `watchEvents(harness, conversationId, context)`, which returned an `AgentEventStream` of batched `AgentEvent` records. `1.5.0` removed that function and every one of its types, and removed `Conversation.viewState()`, which `HarnessEngine.view()` used.

Two constraints shape everything below:

- `Conversation.watch()` is **serialized and folding**: changes made while the listener runs arrive folded into the next call.
- `Harness.observeConversation()` is **synchronous and unfolded**: `advance` gets every change, but "must only record the call, synchronously and quickly, never await, call the Session, or throw."

`WatchCall` carries both `value` (the absolute newest `ConversationView`) and `ops` (a `readonly Op[]` JSON diff whose paths are absolute from the root). `Op` is `["r",v] | ["s",path,v] | ["d",path] | ["a",path,string] | ["t",path,n] | ["p",path,n,n,JsonValue[]] | ["m",path,n[]]`. There is no typed event vocabulary left.

## Goals / Non-Goals

**Goals:**

- Keep the client-visible RPC record stream unchanged while the state source is replaced.
- Preserve per-change granularity, which the async watch cannot guarantee.
- Make the durability of streamed output a startup setting rather than a hidden default.

**Non-Goals:**

- Re-deriving records by diffing successive `value` snapshots. That path is a fallback only, because it cannot recover changes the observer already folded and it costs an O(transcript) comparison per commit.
- Keeping `typebox` as a direct harness dependency.
- Any compatibility layer for `1.4.0` consumers or stored data.

## Decisions

**1. Attach a synchronous observer, marshal through a queue.**

`Conversation.watch()` folds under backpressure and would violate the "one event per change" requirement under load. A synchronous `Observer` never folds because it cannot be busy. The cost is that `advance` may not touch the Session, and the projector needs `isQuiescent()` for settle synthesis.

So `advance` does one thing: `queue.push(call)`. A microtask drain then awaits `projector.handle(call)` in order. Revisions that arrive before the attaching promise resolves are safe to queue, because the router only reads `call.value` and `call.ops`, both absolute.

Alternatives considered: (a) async `watch()` and amend the per-change requirement — rejected, it degrades a client-visible guarantee; (b) `observeCommits()` and rebuild the view locally — rejected, it re-implements the view mount for no gain.

**2. Route by JSON-diff path, not by value diffing.**

The router matches path prefixes to record kinds, for example `["docs","pi.live","generation","message","content",i,"text"]` with an `a` op becomes `message_update` with a `text_delta`, and `["docs","pi.inbox"]` becomes `queue_update`. `call.value` supplies the payload for records that need a whole object (`message_end`, `tool_execution_end`), so no local mirror is maintained.

Alternatives considered: apply ops to a local copy and diff revisions — rejected, it loses intra-commit detail and duplicates the delta algebra Chord already performs.

**3. The view is a live tail; the transcript is read in full.**

`ConversationView.entries` is a window: newest 50, appends, spliced to 50 past 100. `entry_appended` therefore comes from **append** ops only; splice ops are ignored, because no RPC record removes an entry. `get_entries`, `get_tree`, and `export_html` continue to read `Conversation.entries()` in full. This split is the main trap of the migration: treating `view.entries` as the transcript silently loses history past 100 entries.

**4. `pi-schema` builders replace the removed `Type` export.**

`@earendil-works/pi-ai` `1.5.2` exports no `Type`; `pi-schema` is a direct dependency of `pi-ai` and `pi-durable`, and `ToolArgs<T> = Static<T>` already resolves it. `obj()` is closed by default, matching `Type.Object`.

Alternatives considered: import `typebox` directly (works through a transitive dependency, but re-introduces the package pi just removed and is not the supported typing path); plain JSON Schema literals (no type inference for `args`).

**5. `runCounted` returns the driver's row count.**

`SqliteStorage` wraps the executor with `runCounted`, so the PostgreSQL facade must implement it. `pg` reports `rowCount` for the statements durable issues; `null` is mapped to `0` rather than thrown, because the interface promises a number and a refused commit, not a crash.

**6. `persistWithinMs` is a setting, defaulting to `0`.**

`1.5.2` defers progress commits for 1,000 ms, which would let a crash lose about a second of a streamed answer — unacceptable for a harness whose premise is durability. The value is read from `PI_DURABLE_PERSIST_WITHIN_MS` at startup and exposed as a live `progress` getter, so `0` restores per-partial storage without a restart cost. Durable already reads the getter at each use.

**7. Capture an event fixture and gate on it.**

Command fixtures never covered the event stream, so the previous parity claim was untested. A captured `events.ndjson` from `1.5.2` turns the router table from inference into a test. The `message_start`/`message_end` and `turn_start`/`turn_end` rows are the least certain and are the rows the fixture must confirm.

## Risks / Trade-offs

- **The router table is inferred from the changelog and type surface.** → Capture `events.ndjson` before rewriting (T1.5), and treat the four uncertain rows as verify-then-adjust.
- **`turn_start`/`turn_end` may not be reconstructable.** The changelog maps them to `pi.live.run.taskId` moving between generations, which is an inference over two states. → If the fixture shows no faithful derivation, synthesize boundaries from `message_start`. Record the outcome in the design at implementation time.
- **Deferred progress interacts with crash loss.** → Default `0`; the setting exists for hosts that would rather batch.
- **No rollback.** A `1.5.2` write stores documents at version 3, which `1.4.0` cannot read. → Document it in the README (T7.3) and in the release notes.
- **`pi-internals.ts` imports an unsupported package path** for the codemode description. → It still exists in `1.5.2`; add a smoke test so a future move fails loudly.
- **pi-schema coercion changes tool argument handling** (numeric strings, single-to-array) and validation wording. → Assert behavior, not message text, and re-run the model-request differential.

## Migration Plan

1. Bump the six packages and add `pi-schema`; build must fail loudly at every removed import, which enumerates the work.
2. Rewrite the projection behind the existing `watchEvents()` engine method so callers stay unchanged until the router is green.
3. Capture `1.5.2` fixtures and run the differential and conformance suites.
4. Rollback: none. Take a database snapshot before the first `1.5.2` write if a return to `1.4.0` is ever required.

## Open Questions

- Whether `turn_start`/`turn_end` need synthesis from message boundaries can wait for the fixture capture (T1.5); it does not change the specs, the approach, or the task breakdown.
