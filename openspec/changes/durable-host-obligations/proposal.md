# Proposal

## Why

An independent code-verified analysis of the durable framework (`@earendil-works/pi-durable` at
`4afe78de`, pinned 1.5.2) states the contract a *host* has to keep: consult `wake()`, `close()` on
every shutdown path, treat a storage error as a reopen rather than a retry, treat a retired watch as
a value change, and mark a streamed tail provisional. This harness is that host, and it keeps four of
those and breaks three: it discards every framework report (`onReport: () => {}`), it never reopens a
session whose storage failed — so one PostgreSQL reset wedges the session for the life of the
process — and a kill skips `close()`, dropping the deferred tail.

The analysis also counts what the framework charges: a single-tool-call run costs 12 storage calls
structurally, and over a network each is a round trip. This harness measured its reads and never its
writes.

## What Changes

- Accept and classify framework reports: a failed session, a faulted task, and anything else, each
  reaching the user where they are looking (stderr headless, the status line in the interface).
- **Reopen the session after a storage failure**, keeping the session identity and the transcript
  pointer, and refuse a prompt with a typed answer while the reopen is in flight.
- Close the session on `SIGINT` and `SIGTERM` with a bounded wait, so held commits are stored and
  child processes are reaped.
- Report **why a run ended**: the framework's `faulted` reasons (`model_error`, `no_model`,
  `restart_limit`, `invalid_park`) and `unanswered` reasons (`turn_limit`, `nothing_to_answer`,
  `stale`, `aborted`), with a non-zero exit for a run that did not answer.
- Count the write side: throttle the catalog stamp to what `-c` needs, and record calls per turn
  beside the read budget.

## Capabilities

### New Capabilities

None. The obligations belong to capabilities that already own the surfaces.

### Modified Capabilities

- `failure-diagnostics`: a failed session is reopened rather than left dead, a faulted task is
  reported, and a run reports the reason it ended.
- `durable-storage-postgres`: the per-turn write count is recorded, and the catalog stamp is
  throttled so a turn does not spend a round trip on it.

## Impact

- `src/harness/engine.ts`: the report handler, the reopen path, the run outcome, and the stamp
  throttle.
- `src/index.ts` and `src/cli.ts`: signal handlers that close the session; the one-shot exit status.
- `src/harness/oneshot.ts`: the reason a run ended, printed and reflected in the exit code.
- `src/harness/tui/adapter.ts`: the status line for a failure and for a run that did not answer.
- `src/rpc/session.ts` and `src/rpc/server.ts`: a typed refusal while the session is recovering.
- `test/`: a reopen test against a storage that fails once, a signal test, an outcome test, and a
  calls-per-turn measurement.
- `README.md`: the failure vocabulary, the reopen behaviour, and the write budget.
