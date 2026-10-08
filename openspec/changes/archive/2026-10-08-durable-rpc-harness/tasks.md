## 1. Setup and parity baseline

- [x] 1.1 Create the harness package and the TypeScript entry binary
- [x] 1.2 Add pinned dependencies
- [x] 1.3 Record pinned versions and capture the golden fixture corpus
- [x] 1.4 Stand up a local check runner for type checks, unit tests, and fixture replay
- [x] 1.5 Add the release build for the ESM package and the single-executable binary
- [x] 1.6 Replicate pi's process entry markers

## 2. PostgreSQL storage backend (spec: `durable-storage-postgres`)

- [x] 2.1 Define the PostgreSQL schema and migrations
- [x] 2.2 Implement atomic commit with sequence and identifier ownership
- [x] 2.3 Implement lookups and keyset scans with cursors
- [x] 2.4 Implement document incarnations and revisions
- [x] 2.5 Enforce cross-process single-writer with an advisory lock
- [x] 2.6 Implement close and post-close rejection
- [x] 2.7 Run the storage conformance suite against PostgreSQL

## 3. RPC server core (spec: `rpc-parity`)

- [x] 3.1 Implement LF-only JSONL framing
- [x] 3.2 Implement command dispatch and response correlation
- [x] 3.3 Implement the state read commands
- [x] 3.4 Implement the CLI and environment startup contract
- [x] 3.5 Map image content to durable content blocks

## 4. Event projector and settle detection (spec: `rpc-parity`)

- [x] 4.1 Map the run lifecycle events
- [x] 4.2 Map the message events
- [x] 4.3 Map the tool events
- [x] 4.4 Map the queue, compaction, and retry events
- [x] 4.5 Synthesize agent_settled from quiescence
- [x] 4.6 Prime a new attachment from a snapshot

## 5. Transcript projection and control-plane log (spec: `transcript-projection`)

- [x] 5.1 Implement the versioned projection adapter
- [x] 5.2 Record control-plane transitions in an append-only log
- [x] 5.3 Preserve unrecognized entry kinds verbatim
- [x] 5.4 Implement the HTML export

## 6. Command completeness (spec: `rpc-parity`)

- [x] 6.1 Store per-session run-policy overrides
- [x] 6.2 Implement the session management commands
- [x] 6.3 Implement the direct bash and abort_bash commands
- [x] 6.4 Implement the model and thinking commands
- [x] 6.5 Back get_commands with a command registry

## 7. Tooling and extension parity (spec: `harness-tooling-parity`)

- [x] 7.1 Port find, grep, ls, and the platform shell tool
- [x] 7.2 Adapt the codemode extension
- [x] 7.3 Adapt the tool-search extension
- [x] 7.4 Adapt the MCP extension
- [x] 7.5 Inject session metadata into shell tool commands

## 8. Skills and resource loading parity (spec: `harness-tooling-parity`)

- [x] 8.1 Reuse the model runtime, settings, and trust resolution
- [x] 8.2 Align skills and instructions loading

## 9. Transparency and conformance (specs: `rpc-parity`, `durable-storage-postgres`)

- [x] 9.1 Diff the harness event streams against the fixture corpus
- [x] 9.2 Run an external pi RPC client as the acceptance client
- [x] 9.3 Verify that storage selection is invisible to the client
