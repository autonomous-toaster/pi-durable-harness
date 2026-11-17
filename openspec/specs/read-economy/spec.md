# read-economy Specification

## Purpose
Define how much the harness reads from a session's storage and when, so an idle client costs a probe instead of a transcript, a change costs the delta instead of the history, and a status answer costs no transcript read at all.

## Requirements

### Requirement: An idle refresh probes before reading

T1.1 SHALL read the newest entry id BEFORE T1.2 SHALL read any entry record.

#### Scenario: An idle poll finds nothing new

- **WHEN** T1.1 reads the newest entry id and the snapshot already holds that id
- **THEN** T1.2 SHALL read no entry record

#### Scenario: An idle poll finds something new

- **WHEN** T1.1 reads an entry id the snapshot does not hold
- **THEN** T1.2 SHALL read the entries the snapshot lacks

### Requirement: A delivered revision is the primary signal

T1.2 SHALL read entries AFTER T1.1 SHALL report a change.

#### Scenario: A revision arrives

- **WHEN** T1.1 reports a change from the session's revision stream
- **THEN** T1.2 SHALL read entries once for that change

#### Scenario: The timer finds nothing

- **WHEN** T1.1 reports no change on a timer tick
- **THEN** T1.2 SHALL read no entry record for that tick

### Requirement: An idle window costs one probe per poll

T1.3 SHALL count one probe statement per poll AFTER T1.1 SHALL replace the transcript read.

#### Scenario: Sixty seconds of no activity

- **WHEN** T1.3 measures sixty seconds of an idle session
- **THEN** T1.3 SHALL find one probe statement per poll and no entry scan

### Requirement: A change costs the delta

T2.1 SHALL ask for entries beyond the cursor BEFORE T2.2 SHALL update the snapshot.

#### Scenario: One new entry

- **WHEN** T2.1 reads with a cursor at the last held id
- **THEN** T2.1 SHALL receive the entries written after that id

#### Scenario: A long transcript

- **WHEN** T2.1 reads with a cursor on a session of ten thousand entries
- **THEN** T2.1 SHALL transfer no entry written before the cursor

### Requirement: A branch below the cursor resets it

IF T2.3 reads a branch whose newest entry id sits below the cursor THEN T2.1 SHALL reset the cursor to that newest id.

#### Scenario: A rewind lands the branch behind the cursor

- **WHEN** T2.3 reads a branch whose newest entry id sits below the cursor
- **THEN** T2.1 SHALL read every entry of that branch and set the cursor from the branch

### Requirement: One read serves a refresh

T2.1 SHALL complete BEFORE T2.2 SHALL derive the message list and the last answer from the entries T2.1 SHALL return.

#### Scenario: The interface asks for both

- **WHEN** T2.2 answers the message list and the last answer for one refresh
- **THEN** T2.2 SHALL read no additional entry record

### Requirement: A new or rewound branch is read whole

T2.3 SHALL read every entry BEFORE T2.1 SHALL apply a cursor.

#### Scenario: The first snapshot

- **WHEN** T2.3 assembles a snapshot for a session the process has not read
- **THEN** T2.3 SHALL read every entry of the branch

#### Scenario: A rewind moves the branch

- **WHEN** T2.3 reads a branch whose newest entry id is below the cursor
- **THEN** T2.3 SHALL read every entry of the new branch

### Requirement: A status answer costs no transcript read

T3.1 SHALL read the live document BEFORE T3.1 SHALL answer a status request.

#### Scenario: A client polls the status

- **WHEN** T3.1 answers a status request for an idle session
- **THEN** T3.1 SHALL read no entry record

#### Scenario: A client polls while a turn runs

- **WHEN** T3.1 answers a status request during a run
- **THEN** T3.1 SHALL read the live document and no entry record beyond the newest id

### Requirement: The policy and the agent come from documents

T3.2 SHALL read a document BEFORE T3.2 SHALL answer the run policy.

#### Scenario: A status answer names the run policy

- **WHEN** T3.2 answers the steering mode and the follow-up mode
- **THEN** T3.2 SHALL read the policy document and no entry record

### Requirement: A status answer opens no write transaction

T3.3 SHALL count the entry reads AFTER T3.1 SHALL answer a status request.

#### Scenario: One status request

- **WHEN** T3.3 measures one status request on an idle session
- **THEN** T3.3 SHALL find no transcript scan and no write transaction

### Requirement: The baseline is recorded before the change

T4.1 SHALL record the measured statement rate BEFORE T4.2 SHALL measure the same windows.

#### Scenario: A reader checks the claim

- **WHEN** T4.1 records the baseline
- **THEN** T4.1 SHALL record five polls per second, two statements per poll, and forty-three transcript scans per status answer

### Requirement: The re-measured windows match the rule

T4.2 SHALL measure the same three windows AFTER T4.1 SHALL record the baseline.

#### Scenario: The three windows after the change

- **WHEN** T4.2 measures an idle window, a change window, and a status request
- **THEN** T4.2 SHALL find one probe per poll, delta-sized reads, and no transcript scan per status answer

### Requirement: The documentation states the rate

T4.3 SHALL document the idle rate AFTER T4.2 SHALL measure the windows.

#### Scenario: An operator reads the cost model

- **WHEN** T4.3 documents the read economy
- **THEN** T4.3 SHALL state the cost of an idle client and the cost of a status poll

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
