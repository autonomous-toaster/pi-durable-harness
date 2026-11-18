# Design

## Context

The backend's assurance today is a suite that runs only when someone exports a database URL, in a
repository with no CI. Two consequences measured this month: a lost PostgreSQL client threw out of
the process (nothing had run the path in a gate), and the read path's cost was invisible until it was
measured by hand.

The comparison that prompted this change is a third-party PostgreSQL backend for the same framework,
which gates itself on the framework's own conformance suite in CI against `postgres:17`, and which
avoids three things our facade does:

- `pg.types.setTypeParser(20, Number)` mutates the driver for the whole process (`database.ts:22`);
- our `transaction()` is `READ COMMITTED`, so a document read that spans statements can straddle a commit;
- indexed identity columns store plain `text`, so an id with a lone UTF-16 surrogate cannot round-trip.

## Goals / Non-Goals

**Goals:**

- The gate runs the framework's conformance suite against a real PostgreSQL, every push.
- A skip is only legal where the environment is honestly local.
- The facade stops mutating shared driver state, reads a document from one state, and stores
  identities losslessly.

**Non-Goals:**

- No CI matrix beyond Node 22/24 and one PostgreSQL major: the suite tests behaviour, not versions.
- No change to the table layout, the session column, or RLS. Those are verified, not redesigned.
- No deletion helper and no native-port rewrite. Both are larger decisions, recorded as deferred.
- No publishing this backend as its own package. The gate is how a package would earn trust, so the
  gate comes first.

## Decisions

**The conformance suite is the gate, not a supplement.** It is the framework's own acceptance
definition and it already exists in the tree; making it run in CI costs a workflow, not code. Every
other claim about this backend — atomic commits, fork scans, cursor continuation — rests on it.

**A skip is an environment decision, never a silent default.** `CI=true` without a database URL
fails; a developer machine without one skips the PostgreSQL cases and runs the rest. That keeps the
local loop fast without letting the gate lie.

**The pinned connection keeps its `READ COMMITTED` transactions, and reads get a snapshot.** Writes
want ordinary transactions; a document materialization wants one state across its statements. So the
facade gains `snapshot()` beside `transaction()`, and the document read paths — the ones that issue
more than one statement — use it. The alternative (making everything `REPEATABLE READ`) pays
serialization failures on the write path for a property only reads need.

**Per-query type parsing replaces the global parser.** `pg` accepts a `types` config per query; the
storage can pass its own `getTypeParser` that turns `int8` into a number, and the host's own pools
keep the driver's defaults. The current global call is a process-wide side effect from a library that
should not have one.

**Identities are JSON-encoded, exactly as the reference storage stores them.** `kind`, `key_value`
and `request_id` become JSON text so a lone surrogate survives; equality still works because the
encoding is deterministic. The alternative — sanitising the identitiy at the boundary — changes what
the caller asked for.

## What the gate found, in order

Turning the suite on was not a formality. Four findings, in the order they appeared:

1. **The fixture opened storage without a session prefix** — every one of the 33 cases died in
   `stripPrefix` before it touched a row. The suite had been red since the session-column layout
   landed, and nothing ran it.
2. **`SET ROLE` leaked back into the host's pool.** `close()` released the connection still scoped as
   `durable_scope`, so the fixture's `DROP SCHEMA` failed with `must be owner of schema` — a host
   that supplies its own pool would inherit the scope role.
3. **The ownership lock survived on a pooled connection.** Advisory locks are session-scoped and
   re-entrant, so after (2) the same client admitted a second writer. The connection is now destroyed
   on close rather than returned.
4. **Our sixth reference refused a store upstream writes** — a conversation naming an owner task that
   is not stored. Removed: the schema may not be stricter than the framework it stores for.

After those four, 33/33 conformance cases, the parity case, and the snapshot case pass.

## Risks / Trade-offs

- [CI with a database is slower than a unit-only run] → one service container and one job; the
  suites are the point, and 40 seconds of pipeline is cheaper than a shipped crash.
- [A snapshot read can abort under concurrent writes] → document reads are short and the retry lives
  in the caller; a serialization failure is a retryable error, unlike a torn read.
- [JSON-encoded identities are not comparable with plain text in ad-hoc SQL] → the same trade the
  reference storage makes; a reader that queries the table by hand must encode, and the README says so.
- [Per-query parsing costs a little allocation on every storage call] → measured against a database
  round trip, it is noise.

## Deferred, deliberately

- **A conversation deletion command.** Real work (fork traversal, refusals while owned, counts), and
  it deserves its own change.
- **Publishing the backend as a package.** Would need the gate first, and a decision about API
  surface (`/core`, `/node`) that is a product question, not a test.

## Open Questions

None.
