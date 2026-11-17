# Design

## Context

See proposal.md — Why. The measured facts this design works from, taken from a local
PostgreSQL 18 cluster with `pg_stat_statements` and the SEA binary:

- an idle TUI issues the transcript scan **5 times per second** (299 calls in 60 s):
  the adapter's 200 ms timer reads `view()`, and `view()` reads
  `entries(Number.MAX_SAFE_INTEGER)` — every row of the branch, every time;
- one RPC `get_state` issues **43 transcript scans**, 48 conversation reads, and
  9 write transactions, because `state()` reaches the branch through `view()`,
  `resolvedAgent()`, and `policy()`;
- the session scope holds: 5,000 foreign rows seeded in another session were never
  returned, and an idle window opened one connection in 30 s, so neither RLS leakage nor
  TLS handshake churn explains the transfer;
- payload per read is the whole transcript (`rows/call` equals the entry count), so cost is
  linear in transcript size times read frequency.

## Measured baseline

Local PostgreSQL 18, `pg_stat_statements`, a seeded 92 KB transcript (38 entries), the
built `dist/` CLI.

| window | statements | payload |
| --- | --- | --- |
| 30 s idle TUI | 150 x transcript scan (38 rows each), 150 x conversation read | 5,700 rows, ~16.9 MB in 30 s (~2 GB/hour idle) |
| one `get_state` | 41 x transcript scan (1,528 rows), 45 x conversation read, 5 x document, 5 x revision | ~3.7 MB for one status answer |

The statements around a status answer include 9 `BEGIN`/`COMMIT` pairs. A check of the write
statements shows none of them is part of the status path — no `INSERT` or `UPDATE` runs there —
so those pairs are read transactions, not writes.

After the change, on the same cluster and the same 92 KB transcript:

| window | statements | payload |
| --- | --- | --- |
| 60 s idle TUI | 30 probes (2 rows each), 30 conversation reads | 60 rows, ~145 KB in 60 s (~8.6 MB/hour idle) |
| one `get_state` | 6 probes (12 rows) plus one open-time prime (38 rows once per process) | ~120 KB per poll after the first |

That is 189x fewer rows on an idle window and about 30x less payload for a cold status answer
(127x for a warm one). The remaining per-poll cost is one record, because durable's entries API
returns records and offers no id-only read; the cadence of the safety-net timer (2 s) is what
keeps that record cheap.

So one idle terminal costs about 2 GB/hour at 92 KB of transcript, and a client polling
status once a second costs about 13 GB/hour. Both numbers reproduce with one command pair:
`pg_stat_statements_reset()`, wait, read `pg_stat_statements`.

The overage that prompted this change is **not attributable**: the provider's dashboard is
not reliable enough to trust its query count, and the resumed session id was not recorded.
So the change rests on the read rate measured above, which anyone can reproduce on a local
cluster in a few minutes, and not on the bill. Should a future overage need attribution, the
local procedure in task 4.1 is the instrument: one idle window and one status request,
attributed per statement.

## Goals / Non-Goals

**Goals:**

- An idle client reads one row per poll, whatever the transcript size.
- A change reads the entries written since the last read.
- A status answer reads documents and one entry id, never the branch.
- Every claim is measured on the same local cluster before and after.

**Non-Goals:**

- No change to what a session stores, to the projection, or to any client-visible shape.
- No framework change: durable's branch read for context assembly stays as it is.
- No attempt to compress the wire; PostgreSQL offers no protocol compression.
- No change to the write path beyond removing the writes a status poll does not need.

## Decisions

**The probe is the newest entry id, read through durable's own entries API.** The obvious
alternative — `SELECT next_id FROM durable_metadata` — reaches into a table the framework
owns and assumes its name and meaning. `entries({ order: "descending" }, 1)` returns one
record and stays inside the public API. It costs one record per poll, and only until
incremental reads land, at which point a probe costs one record and a change costs the
delta.

**The revision stream is the primary signal; the probe is the safety net.** The adapter
already subscribes to `observeConversation`, which is fed from commits as memory adopts
them, so a change reaches the client without any read. The timer exists because a missed
revision would otherwise leave the transcript stale (see the comment in
`startWatching`). Keeping the timer but making it probe preserves that safety at ~50 bytes
per tick instead of a full transcript.

**A cursor makes the delta possible.** Durable's `entries()` already takes an `after`
argument; the harness passes no cursor today. The snapshot keeps the highest id it holds
and asks for entries above that id. Two cases force a full read, both rare: a first
snapshot (`cursor` unset), and a branch whose newest id sits below the cursor (a rewind or
a fork, where the id space restarts below the old head).

**One read serves a refresh.** `refresh()` currently calls `entries()`, `messages()`
(`conversation.context()`, a second branch read), and `lastAssistantText()` (a third).
Messages and the last answer are projections of entries the refresh already has, so both
become pure functions over the snapshot. This is the change that removes three of the four
reads a changed poll costs.

**A status answer is assembled, not read.** `state()` needs the run policy, the agent
model, the live document, and a message count. The first two live in documents the session
already watches; the count comes from the snapshot's newest id. Reading the branch for
them is what produced 43 scans per poll. A status poll must also stop opening write
transactions: a read-only question should not commit anything.

**The baseline lives in the change and in the README.** The numbers above are reproducible
with the local cluster (`pg_stat_statements`, one idle window, one status request), which is
what makes an after-the-fact claim checkable rather than asserted.

## Risks / Trade-offs

- [A missed revision leaves the transcript stale until the next probe finds the new id] →
  The probe compares an id, not a payload, so the recovery is one extra read and the timer
  stays at its current 200 ms cadence.
- [A cursor read can miss an entry written between the probe and the read] → The cursor is
  the last held id, not the probed id, so a row written in between is simply read on the
  next pass; the probe is only an early-exit.
- [Deriving messages from entries can drift from `conversation.context()`] → Context
  assembly follows pi's compaction and fork rules; the derivation reuses the projection
  the transcript already renders, and a differential test against the current answer
  covers the branch shapes (plain, compacted, forked).
- [Removing the write transaction from `state()` may drop a side effect a client relies
  on] → The writes observed are durable's own bookkeeping (document and provider rows);
  the session stamps activity on a real request, which stays.
- [A probe per poll is still one query per 200 ms] → Acceptable: it is one row of one
  table, and the alternative (no timer) trades a stale transcript for the saving.

## Open Questions

None.
