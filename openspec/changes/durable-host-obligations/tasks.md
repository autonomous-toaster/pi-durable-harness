## 1. Framework reports (spec: `failure-diagnostics`)

- [x] 1.1 Accept the framework's report handler and classify a failed session separately from a faulted task. Verify a test classifies each kind
- [x] 1.2 Report a faulted task where the user is looking: stderr headless, the status line in the interface. Verify a test asserts a faulted task is reported and a failed session is not conflated with it

## 2. Reopen (spec: `failure-diagnostics`)

- [x] 2.1 Reopen the session after a classified storage failure: close, reopen the same storage, resume. Verify a test with a storage that fails once observes a continued session
- [x] 2.2 Answer a prompt with a typed refusal while a reopen is in flight. Verify a test asserts the refusal names the recovery
- [x] 2.3 Keep the session identity and the transcript pointer across a reopen. Verify a test reads the pre-failure transcript after the reopen at the same session
- [x] 2.4 Back off between failed reopen attempts and report each one. Verify a test observes the wait and the report

## 3. Shutdown (spec: `failure-diagnostics`)

- [x] 3.1 Close the session on `SIGINT` and `SIGTERM` with a bounded wait. Verify a test sends a signal and observes a close
- [ ] 3.2 Store a held commit before the process exits. Verify a measurement finds the deferred commit stored after a signal mid-stream

## 4. Run outcomes (spec: `failure-diagnostics`)

- [x] 4.1 Report the reason a run ended for the faulted and unanswered vocabularies. Verify a test asserts the reason and the advice
- [x] 4.2 Answer a non-zero exit status for a run that did not answer. Verify a test asserts the status for a faulted run and for an answered run

## 5. Write budget (spec: `durable-storage-postgres`)

- [x] 5.1 Throttle the catalog stamp to at most once per minute. Verify a test asserts the second prompt inside a minute writes no stamp
- [x] 5.2 Record the storage calls one turn costs beside the read budget. Verify the measurement is recorded in the change

## 6. Documentation (spec: `failure-diagnostics`)

- [x] 6.1 Document the failure vocabulary, the reopen behaviour, and what a signal guarantees in the README. Verify the README names the reopen and the bounded tail loss

## Not verified

- 3.2 Store a held commit before the process exits: the handler and the close path are tested (a
  `SIGTERM` on the real CLI exits 143 after `closed on SIGTERM`), and storing held commits is
  `close()`'s documented job — but the live measurement of a deferred commit after a mid-stream
  signal was attempted three times and not obtained (the model answered before the signal, and the
  process lookup that sends it needs a more careful harness). Left unchecked rather than claimed.
