## 1. Idle refresh (spec: `read-economy`)

- [x] 1.1 Read the newest entry id as a change probe before any entry record. Verify a test asserts zero entry reads across sixty idle polls
- [x] 1.2 Read entries for a delivered revision only. Read no entry for a timer tick that finds nothing. Verify a test asserts one entry read per revision and none per empty tick
- [x] 1.3 Re-measure sixty seconds of an idle session against the recorded baseline. Verify the measurement finds one probe statement per poll and no entry scan

## 2. Incremental transcript reads (spec: `read-economy`)

- [x] 2.1 Ask for entries after the last id the snapshot holds. Verify a test asserts the read asks only for entries above the cursor
- [x] 2.2 Derive the message list and the last answer from the entries a refresh read. Verify a test asserts one storage read serves a refresh
- [x] 2.3 Read every entry for a first snapshot and for a branch below the cursor. Verify a test covers both cases

## 3. Status answers (spec: `read-economy`)

- [x] 3.1 Answer a status request from the live document and the snapshot. Verify a test asserts a status answer reads no entry record
- [x] 3.2 Answer the run policy and the agent from documents rather than the entry branch. Verify a test asserts the policy answer reads no entry record
- [x] 3.3 Re-measure one status request against the recorded baseline. Verify the measurement finds no transcript scan and no write transaction

## 4. Measurement and documentation (spec: `read-economy`)

- [x] 4.1 Record the measured baseline for both surfaces in the change. Verify the numbers match a local `pg_stat_statements` reading
- [x] 4.2 Re-measure the idle window, the change window, and a status request after the change. Verify the three windows match the rule in the spec
- [x] 4.3 Document the read economy and the measured rate in the README. Verify the README states the idle cost and the status-poll cost
