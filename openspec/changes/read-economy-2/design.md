# Design

## Context

`read-economy` left three full-transcript reads on paths that run often, and the idle probe still
ships whole records. Measured on a local cluster, 92 KB transcript:

- 30 probes in 60 s of idling, **2 records each** (~108 MB/hour when the newest entry is a 30 KB
  tool result) — the storage returns `limit + 1` rows, so a probe for one id carries two records;
- one settled turn issues `entries()` (the whole branch) from `submitAndWait`;
- `policy()` reads the branch, and four RPC setters call it, so one settings toggle costs a
  transcript;
- `refreshSnapshot` re-reads entries and messages before **every** extension event;
- partials commit every 100 ms while an answer streams (default `partialIntervalMs`), which a
  managed provider bills as replication egress.

## Measured windows

Same local cluster, same 92 KB transcript, one process per window (each window therefore includes
the open, which is where the 150-row baseline of the first row comes from).

| window | before this change | after |
| --- | --- | --- |
| 60 s idle | 30 probes, 60 rows | **2 probes, 4 rows** |
| one turn | 1 branch read (41 rows) + 17 probes + ~90 partial commits | **6 probes, 12 rows, 5 commits** |
| one status poll | 1 probe, 2 rows | 1 probe, 2 rows (unchanged) |
| one settings toggle | 1 branch read (38 rows) | **0 entry reads** |

Deltas are read from the difference between a one-command and a five-command run, so the open cost
cancels: 5 status polls add 4 probes (one each), 5 toggles add no statement at all.

Recorded for a follow-up rather than fixed here: **opening a process still reads the branch about
four times** (150 rows for one command), from the prime, `Harness.open`, and `resolvedAgent`. That
cost is per process, not per poll, so it does not scale with an idle terminal — but it is the next
thing worth measuring.

## Goals / Non-Goals

**Goals:**

- Idle cost independent of how the revision stream behaves, and bounded by ~1 probe per 30 s.
- No full-transcript read outside the three cases `read-economy` already justified (first
  snapshot, rewind, compaction).
- A server session that commits a streamed answer a handful of times per second, not ten.

**Non-Goals:**

- No change to what is stored, to the transcript, or to any client-visible shape other than the
  coarseness of progress during a streamed answer.
- No probe that avoids a record: durable's entries API has no id-only read, so the cadence is the
  lever.
- No change to SQLite, where each partial is a local write and batching would only delay the TUI.

## Decisions

**The cadence is a rule, not a constant.** The adapter asks a pure function whether to probe, given
the last revision and the last probe. The rule: a revision within the last 30 s means the stream is
warm and no probe is needed; otherwise one probe per 30 s. Being a pure function, sixty idle
seconds are asserted in a test rather than inferred from a timer. The alternative — removing the
timer — trades a stale transcript on a missed revision for a saving that is already near zero at
this cadence.

**A settled turn reads the delta.** `submitAndWait` currently calls `entries()` to refresh the
branch the warmer evaluates. The delta read does the same work and refreshes the projected branch
incrementally, so the warmer sees the same view at a fraction of the transfer. The branch cache
therefore gains an append path, not a second source of truth.

**The run policy answers from the snapshot.** `#policy` is already maintained by every read, so
`policy()` answers from it. The storage read stays, renamed, for the one caller that needs the
stored value rather than the snapshot: the prime at open.

**The extension snapshot reads nothing.** `refreshSnapshot` builds the `SessionManager`-like view
extension handlers read. Both halves are projections of what the session already holds, so the
snapshot becomes a pure assembly over `knownEntries` and `messagesKnown`. The alternative —
throttling the refresh — still reads sometimes for no reason.

**Partial batching is a server default.** A local SQLite write is free and immediate, so batching
would only delay what the user sees. On a server every partial is a commit plus the WAL behind it,
and 100 ms is an implementation detail of pi's streaming, not a promise to the user. The default
becomes 500 ms when the session stores to PostgreSQL and the operator has not chosen an interval.
This is the one deliberate behaviour change: mid-answer progress updates coarser on a server, and
the README says so, with `PI_DURABLE_PERSIST_WITHIN_MS=0` as the way back.

## Risks / Trade-offs

- [A missed revision is now noticed up to 30 s late] → The stream is fed by the process's own
  commits, so a miss is a bug rather than a race; a late transcript is the cheap side of that
  trade, and the probe still corrects it without a restart.
- [Batching hides up to 500 ms of a streamed answer from a second client] → The answer is stored
  complete; only progress granularity changes, and the interval is one variable.
- [A delta read that keeps the branch current could drift from a full projection] → The projection
  is the same function over a superset of records; the existing transcript tests render from it,
  and a rewind still forces a full read.
- [Answering `policy()` from the snapshot could lag a policy entry written by another process] →
  One writer per session is durable's rule and the advisory lock enforces it, so the snapshot is
  the only writer's view of its own writes.

## Open Questions

None.
