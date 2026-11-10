## 1. Pinned version and fixtures (spec: `harness-tooling-parity`)

- [x] 1.1 Pin every `@earendil-works/*` dependency to `1.5.2`. Verify `package-lock.json` resolves each one to `1.5.2`
- [x] 1.2 Declare `@earendil-works/pi-schema` as a direct dependency. Verify `npm install` exits 0
- [x] 1.3 Re-capture the golden command fixtures from pi 1.5.2 into `test/fixtures/pi-1.5.2/`. Verify the capture script exits 0
- [x] 1.4 Re-run the fixture diff against the re-baselined corpus. Verify no unexpected record name or field remains
- [x] 1.5 Capture one scripted run event stream from pi 1.5.2 into `test/fixtures/pi-1.5.2/events.ndjson`. Verify the file ends with one line feed

## 2. Tool schemas (spec: `harness-tooling-parity`)

- [x] 2.1 Replace the pi-ai `Type` import with pi-schema builders in `src/tools/index.ts`. Verify the built-in definitions still match the fixture
- [x] 2.2 Replace the pi-ai `Type` import with pi-schema builders in `src/tools/mcp.ts` and `src/tools/tool-search.ts`. Verify the declared set is unchanged
- [x] 2.3 Verify pi-schema coercion converts a numeric string argument. Verify a missing required argument is rejected
- [x] 2.4 Verify the composed codemode description matches the captured fixture
- [x] 2.5 Re-port pi 1.5.2's system prompt strings into `src/harness/system-prompt.ts`. Verify the ported builder matches pi's builder
- [x] 2.6 Match pi 1.5.2's codemode declaration for an MCP tool. Verify the differential reports no difference

## 3. Storage facade (spec: `durable-storage-postgres`)

- [x] 3.1 Add `runCounted` to `PostgresExecutor` and `PostgresDatabase`. Verify a two-row statement resolves with 2
- [x] 3.2 Run the PostgreSQL conformance suite against the batched `commit()`. Verify it passes

## 4. Event projection (spec: `event-projection`)

- [x] 4.1 Report run lifecycle changes as `agent_start` and `agent_end` from the `pi.live.run` path. Verify the pair against the event fixture
- [x] 4.2 Emit one assistant message event per change from the generation message content ops. Verify the deltas against the event fixture
- [x] 4.3 Accumulate running tool output into partial results from the tool slot ops. Verify the accumulated text
- [x] 4.4 Report the compaction result or abort from the compaction ops. Verify one record per compaction
- [x] 4.5 Synthesize `agent_settled` at quiescence. Verify exactly one record per settle
- [x] 4.6 Prime a new attachment from the acquisition value without a snapshot replay. Verify a mid-run attach receives no snapshot
- [x] 4.7 Add the JSON-diff path router that maps each `pi.live`, `pi.inbox`, `pi.agent`, and `entries` path to one RPC record. Verify each row against the event fixture
- [x] 4.8 Queue each observer revision and drain it in order outside the observer callback. Verify no Session read runs inside `advance`

## 5. Session reads (spec: `rpc-parity`)

- [x] 5.1 Replace `viewState()` in `engine.view()` with `Session.doc` reads for `pi.inbox` and `pi.live`. Verify the `get_state` fields
- [x] 5.2 Count `get_state.messageCount` over the full history. Verify a 150-entry conversation reports 150
- [x] 5.3 Verify `get_entries`, `get_tree`, and `export_html` project the full history

## 6. Progress durability (spec: `cli-prompt-modes`)

- [x] 6.1 Read `PI_DURABLE_PERSIST_WITHIN_MS` at startup. Warn on an invalid value and default to 0. Verify the parse test
- [x] 6.2 Pass the value through `createHarnessSettings` as a live `progress` getter. Verify a change applies without restart
- [x] 6.3 Verify a window of 0 stores a partial answer as it arrives
- [x] 6.4 Verify a large window holds the partial until the next document read

## 7. Verification

- [x] 7.1 Add the event projection conformance test over `events.ndjson`. Verify `npm run check` passes
- [x] 7.2 Run `node tools/acceptance.mjs`. Verify it terminates at quiescence with no unexpected record
- [x] 7.3 Verify the README records the one-way migration and the absent rollback
