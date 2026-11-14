# Proposal

## Why

`read-economy` removed the pathological read, and what is left is three smaller versions of the
same mistake plus a write-side one. Measured after that change, on a 92 KB transcript: the
safety-net probe still ships two whole records every 2 seconds (~108 MB/hour idle when the
newest entry is a 30 KB tool result), a settled turn re-reads the whole branch, the run policy
re-reads the branch for each RPC settings toggle, the extension snapshot re-reads the branch and
the context before every extension event, and partial progress commits every 100 ms during a
streamed answer — which a managed provider bills as replication egress.

## What Changes

- The safety-net probe yields to a warm revision stream: an idle session probes at most once per
  30 seconds, and only after the stream has been silent that long.
- A settled turn reads the delta, not the branch.
- The run policy answers from the snapshot, so a settings toggle reads no entry.
- The extension snapshot is assembled from the entries and messages the snapshot already holds,
  so a hook costs no read.
- **PostgreSQL batches partial progress by default** (500 ms), configurable through the existing
  `PI_DURABLE_PERSIST_WITHIN_MS`. Progress updates mid-answer become coarser; the stored answer is
  unchanged.
- The three windows and a turn window are measured again, and the trade is documented.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `read-economy`: the cadence of the safety-net probe, the reads a settled turn and a settings
  toggle cost, the reads an extension event costs, and the default partial batching on a server.

## Impact

- `src/harness/tui/adapter.ts`: the probe decision moves into a pure function with a cadence.
- `src/harness/read-plan.ts`: the cadence decision, so sixty idle seconds are assertable.
- `src/harness/engine.ts`: `submitAndWait` reads the delta, `policy()` answers from the snapshot,
  and a delta keeps the projected branch current.
- `src/extensions/actions.ts`: the snapshot is built from the known entries and messages.
- `src/harness/config.ts`: the deferred-progress default for PostgreSQL.
- `README.md`: the cadence, the batching default, and the measured windows.
