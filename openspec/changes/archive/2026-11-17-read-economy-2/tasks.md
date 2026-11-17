## 1. Idle cadence (spec: `read-economy`)

- [x] 1.1 Probe only after thirty seconds without a revision. Verify a test asserts no probe while revisions arrive and one probe after silence
- [x] 1.2 Re-measure sixty idle seconds against the recorded baseline. Verify the measurement finds no more than three probes

## 2. Reads during a turn (spec: `read-economy`)

- [x] 2.1 Read the delta when a turn settles instead of the branch. Verify a test asserts the settle path reads no earlier entry
- [x] 2.2 Answer the run policy from the snapshot. Verify a test asserts a settings toggle reads no entry record
- [x] 2.3 Assemble the extension snapshot from the known entries and messages. Verify a test asserts an extension event reads no entry record

## 3. Partial batching (spec: `read-economy`)

- [x] 3.1 Batch partial progress by default on PostgreSQL. Verify a test asserts a PostgreSQL configuration defers partials by five hundred milliseconds
- [x] 3.2 Keep the interval configurable through `PI_DURABLE_PERSIST_WITHIN_MS`. Verify a test asserts an explicit value wins and a local session stores each partial

## 4. Measurement and documentation (spec: `read-economy`)

- [x] 4.1 Re-measure the idle window, a turn, a status poll, and a settings toggle. Verify the four measurements are recorded in the change
- [x] 4.2 Document the cadence and the batching trade in the README. Verify the README states the coarser progress and how to change the interval
