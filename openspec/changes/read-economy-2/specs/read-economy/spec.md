## Task Reference

| T ID | Description |
| --- | --- |
| T1.1 | Probe only after thirty seconds without a revision |
| T1.2 | Re-measure the idle window |
| T2.1 | Read the delta when a turn settles |
| T2.2 | Answer the run policy from the snapshot |
| T2.3 | Assemble the extension snapshot from the snapshot |
| T3.1 | Batch partial progress by default on PostgreSQL |
| T3.2 | Keep the batch interval configurable |
| T4.1 | Re-measure the windows and a turn |
| T4.2 | Document the cadence and the batching trade |

## ADDED Requirements

### Requirement: The safety-net probe yields to a warm stream

T1.1 SHALL read a probe again only AFTER T1.1 SHALL pass thirty seconds without a revision.

#### Scenario: Revisions keep arriving

- **WHEN** T1.1 reads a revision within thirty seconds of the last one
- **THEN** T1.1 SHALL read no probe

#### Scenario: The stream goes quiet

- **WHEN** T1.1 reads no revision for thirty seconds
- **THEN** T1.1 SHALL read one probe

### Requirement: The cadence is measured

T1.2 SHALL measure sixty idle seconds AFTER T1.1 SHALL apply the cadence.

#### Scenario: One idle minute

- **WHEN** T1.2 measures sixty seconds of an idle session
- **THEN** T1.2 SHALL find no more than three probes

### Requirement: A settled turn reads the delta

T2.1 SHALL read the delta AFTER T1.1 SHALL read the newest entry id.

#### Scenario: A turn ends

- **WHEN** T2.1 reads the storage as a turn settles
- **THEN** T2.1 SHALL read the entries written during the turn and no earlier entry

### Requirement: The run policy answers from the snapshot

T2.2 SHALL answer the run policy AFTER T2.1 SHALL record a policy entry.

#### Scenario: A settings toggle

- **WHEN** T2.2 answers the run policy for a settings change
- **THEN** T2.2 SHALL read no entry record

### Requirement: An extension event reads no entry

T2.3 SHALL assemble the snapshot BEFORE T2.3 SHALL read any entry record.

#### Scenario: A hook dispatches during a turn

- **WHEN** T2.3 assembles the snapshot for one extension event
- **THEN** T2.3 SHALL read no entry record and no context message

### Requirement: Progress batches on a server

T3.1 SHALL wait the batch interval BEFORE T3.1 SHALL commit a partial.

#### Scenario: A streamed answer on PostgreSQL

- **WHEN** T3.1 stores a streamed answer with the default interval
- **THEN** T3.1 SHALL commit at most two partials per second

#### Scenario: A local session

- **WHEN** T3.1 stores a streamed answer in SQLite
- **THEN** T3.1 SHALL commit each partial as it arrives

### Requirement: The interval stays configurable

T3.2 SHALL read `PI_DURABLE_PERSIST_WITHIN_MS` BEFORE T3.1 SHALL choose the interval.

#### Scenario: An explicit interval

- **WHEN** T3.2 reads an explicit `PI_DURABLE_PERSIST_WITHIN_MS`
- **THEN** T3.1 SHALL use that interval

### Requirement: The windows are measured again

T4.1 SHALL measure the idle window and a turn AFTER T3.1 SHALL batch partials.

#### Scenario: The four windows after the change

- **WHEN** T4.1 measures an idle window, a turn, a status poll, and a settings toggle
- **THEN** T4.1 SHALL record the statements each window costs

### Requirement: The documentation states the trade

T4.2 SHALL document the batch interval AFTER T4.1 SHALL measure the windows.

#### Scenario: An operator reads the progress trade

- **WHEN** T4.2 documents partial batching
- **THEN** T4.2 SHALL state that a PostgreSQL session shows coarser progress, and how to change it
