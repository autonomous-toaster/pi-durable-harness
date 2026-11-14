# Proposal

## Why

An idle session asks PostgreSQL for its whole transcript five times a second, and one RPC
status poll asks for it forty-three times. Measured against a local cluster: an idle TUI
issues `SELECT record FROM entries ...` 299 times in 60 seconds (every row of the
transcript, every time), and one `get_state` issues 43 of those scans plus 48 conversation
reads and 9 transactions. At 5 reads/second a 61 KB transcript costs 25 GB per day, which
is the whole of a 5 GB quota in five hours of leaving a terminal open.

## What Changes

- An idle refresh asks a **change probe** — one row, the newest entry id — instead of
  reading the transcript, and reads entries only when the probe says something changed.
- A transcript read is **incremental**: it asks for entries after the last id already held,
  so a change costs the delta rather than the history.
- One read serves a refresh: the message list and the last answer are derived from the
  entries the refresh already read, instead of re-reading the branch twice more.
- A status answer (`get_state`, and the panel) comes from the live document, the newest
  entry id, and the snapshot the session already holds — no transcript read.
- The recorded baseline (statements per idle poll, transcript reads per status answer) and
  the re-measured numbers after the change, in the README and in the change.

## Capabilities

### New Capabilities

- `read-economy`: how much the harness reads from a session's storage, and when. One
  behaviour owns the rule for every surface: an idle client probes, a change costs the
  delta, and a status answer costs no transcript read.

### Modified Capabilities

None. The surfaces keep their contracts; what changes is the read behind them.

## Impact

- `src/harness/engine.ts`: a probe read, an incremental entries read, and a status answer
  assembled from the snapshot.
- `src/harness/tui/adapter.ts`: the 200 ms timer probes instead of reading the view; a
  delivered revision still reads, once.
- `src/rpc/session.ts`: `state()` answers without the transcript; `get_state` stops opening
  write transactions.
- `src/harness/events.ts`: the revision stream becomes the primary signal, with the probe as
  the safety net.
- `test/`: a read-count test per surface, and the local measurement recorded as the baseline.
- `README.md`: the read economy, the measured rate, and why an idle client is free.
