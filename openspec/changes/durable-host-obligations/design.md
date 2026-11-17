# Design

## Context

The framework's host contract, from the durable spec at `4afe78de` (pinned 1.5.2) as summarised by
an independent code-verified analysis:

- **On start**: open, then `resume()`; inspecting first is allowed and marks nothing. — we do this.
- **Wake**: consult `wake()`; without `onWake` the framework arms its own timer that keeps the
  process alive for a sleeping task. — we rely on that, and it is correct for a CLI host.
- **Shutdown**: `close()` on shutdown paths, because it *"stores held commits, joins invocations"*.
- **Storage errors** (invariant 8): *"a storage error is fatal to the open Session, which must be
  reopened"*; the playbook says *"reopen; reconciliation decides the prefix"* and *"storage errors
  are treated as reopen, not retry"*.
- **Reports**: `onReport` is how a host separates `storage_failed` (a platform reset) from
  `task_faulted`, and from hook failures.
- **Run outcomes**: `faulted` (`model_error`, `no_model`, `restart_limit`, `invalid_park`) and
  `unanswered` (`turn_limit`, `nothing_to_answer`, `stale`, `aborted`), each with its own reaction.
- **Cost**: a single-tool-call run costs **12 storage calls** structurally; over a network each is a
  round trip. Cross-conversation batching is where the framework recovers round trips, which a
  one-conversation-per-process host cannot use.

Our current state, from the code: `onReport: () => {}` (`engine.ts:345`); `harness.resume()`
(`engine.ts:351`); `close()` only on the normal return path (`engine.ts:947`); no reopen anywhere;
no signal handler; the one-shot path prints the last text without a reason or a per-reason exit.

## Measured

One turn on the local PostgreSQL cluster, `pg_stat_statements`, `ollama-cloud/deepseek-v4.1-flash:cloud`:

- **66 statements, 22 distinct per turn**, of which **5 commits** (`BEGIN`/`COMMIT` pairs), 4 task
  `INSERT`s, and 5 statements against `durable_metadata`. That is the write floor the framework
  describes (12 storage calls per single-tool-call run), seen through the PostgreSQL facade where
  one storage call becomes several statements.
- **The catalog stamp costs nothing per turn**: open writes one `INSERT` into `harness_sessions`,
  the first turn of a process writes one more, and a second prompt inside the same minute writes
  none (`shouldStamp` throttles to one a minute).

**A live PostgreSQL reopen, measured**: with a session holding 6 entries, the cluster was stopped
with `-m immediate` and started again. The process stayed alive, reported `connection lost`,
retried with backoff (`ECONNREFUSED` ×3), then reported `session reopened at conversation 1` — and
all 6 entries were still there. Two bugs only this path could show had to be fixed first:

- `pg` emits `error` on an **idle pooled client**, and an unhandled `error` is fatal: the process
  exited before the session could report anything. The pool now carries a listener.
- The storage holds a **checked-out** client for the session's life, which `pg` does not guard: the
  same crash came through that client. `PostgresDatabase.open` now takes an `onError` for it.

Not measured: a deferred commit forced to storage by a signal mid-stream. The mechanism is the
framework's (`close()` stores held commits) and the handler is tested, but the live measurement is
open — recorded in tasks.md rather than claimed here.

## Goals / Non-Goals

**Goals:**

- A session that loses its storage comes back by itself, without losing the transcript.
- Every framework report reaches a human, classified, instead of being dropped.
- A signal closes the session, so the deferred tail is stored.
- A run that did not answer says why, and exits accordingly.
- The write cost of a turn is a number we know.

**Non-Goals:**

- **No cross-conversation batching.** The framework coalesces commits across conversations in one
  process (measured 1.73x at C=8); recovering that means one writer process per schema, which
  contradicts the process-per-session model. Recorded, not built.
- **No hibernating host.** `wake()`/`onWake` exist for a host whose process may be evicted. We keep
  durable's default timers; adopting `onWake` is a decision for a future serverless shape.
- No change to what a session stores, and no new durable concept: every behaviour here is the
  framework's documented contract, implemented by the host.

## Decisions

**A reopen is a new open with the same identity, not a retry loop inside the engine.** The engine
holds the session key and the current conversation pointer; a reopen closes the harness, drops the
pool, opens the storage again, opens the harness with the same `readOnly: false`, calls `resume()`,
and re-reads the snapshot. Durable's own rule is that the reopen decides the committed prefix, so the
transcript after a reopen is whatever storage holds — no reconstruction from memory.

**The session refuses work while it is down.** Invariant 8 means commits reject in the window; rather
than let each commit surface as an error, the engine answers a prompt, a steer and an abort with one
typed refusal (`session recovering`) until the reopen finishes. This is the same discipline as the
viewer refusal: a client learns why, in a value, not as a transport error.

**The report handler is the only new observer in the engine.** It classifies a report into a failed
session (reopen), a faulted task (transcript plus status), or anything else (a diagnostic), which
keeps one path for every framework failure instead of a special case per symptom.

**The deferred window is bounded, and the shutdown says so.** With `PI_DURABLE_PERSIST_WITHIN_MS`
at 500 ms on PostgreSQL, `close()` on a signal stores the held commit; only `SIGKILL` loses up to
that window. The README states the difference, because "committed is durable" and "what you see is
committed" are different claims and the second one is false during a stream.

**A run outcome is a first-class result.** The one-shot path answers `{ status, reason }`, prints the
reason with the framework's advice, and exits non-zero when the run did not answer. The interface
sets one status line on `agent_settled` for a reason it has, rather than silently ending.

**The catalog stamp is throttled by a value, not by a flag.** `-c` finds a session by
`last_used`; a stamp older than a minute is stale enough for that and costs one round trip per
minute instead of one per turn. The throttle keeps the first stamp of a process so a fast
one-shot still registers.

## Risks / Trade-offs

- [A reopen could loop against a permanently broken backend] → backoff grows and each attempt is
  reported; the session stays in the recovering state, where prompts are refused, rather than
  accepting work it cannot commit.
- [A reopen while a tool invocation is in flight could duplicate an effect] → the close joins
  invocations first; durable's own recovery then applies the replay policy (default: report
  interrupted), so an effect is never silently repeated.
- [A signal handler could hang on a wedged tool] → the close is bounded by a timeout, after which the
  process exits as it does today; the bound is logged.
- [Reporting a faulted task in the interface could duplicate the transcript] → the reason goes to a
  status line, not into the transcript, so what pi renders is unchanged.
- [Throttling the stamp could make `-c` miss a very recent session] → the stamp is written on the
  first turn of a process and at most once per minute after; the risk window is one minute of a
  session that never wrote a stamp, which the process's first turn covers.

## Open Questions

None. Two facts remain unmeasured until the tasks run: whether our facade tolerates a reopen of the
same pool (task 2.1) and what a turn actually costs in calls (task 5.2).
