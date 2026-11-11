# event-projection Specification

## Purpose
Derive pi's RPC event records from Durable's conversation state so an existing pi RPC client receives the same record stream it receives from `pi --mode rpc`.

## Requirements

### Requirement: The event fixture precedes the router

T1.5 SHALL complete BEFORE T4.7 SHALL run.

#### Scenario: Router work follows the capture

- **WHEN** T1.5 completes
- **THEN** T4.7 SHALL run

### Requirement: The observer records synchronously

T4.8 SHALL ALWAYS record each revision into a queue during the observer callback.

#### Scenario: A revision is recorded without a Session read

- **WHEN** T4.8 runs and a revision arrives
- **THEN** T4.8 SHALL record the revision without a Session read

### Requirement: Each revision reaches the projector unfolded

T4.8 SHALL ALWAYS forward every revision to the projector without folding.

#### Scenario: Two commits produce two revisions

- **WHEN** T4.8 runs and two commits land between drains
- **THEN** T4.8 SHALL forward two revisions

### Requirement: The router maps every live path

T4.7 SHALL ALWAYS map each live, inbox, agent, and entry path to one RPC record.

#### Scenario: Each documented path yields a record

- **WHEN** T4.7 runs over the captured event fixture
- **THEN** T4.7 SHALL map each documented path to one RPC record

### Requirement: Settle follows the run end

T4.5 SHALL run AFTER T4.1 SHALL report the run end.

#### Scenario: Settle comes at the run end

- **WHEN** T4.1 reports the run end
- **THEN** T4.5 SHALL run

### Requirement: Tool output precedes settle

T4.3 SHALL complete BEFORE T4.5 SHALL run.

#### Scenario: Partial output precedes settle

- **WHEN** T4.3 completes
- **THEN** T4.5 SHALL run

### Requirement: Compaction precedes settle

T4.4 SHALL complete BEFORE T4.5 SHALL run.

#### Scenario: A compaction result precedes settle

- **WHEN** T4.4 completes
- **THEN** T4.5 SHALL run

### Requirement: Entry appends survive the window

T4.2 SHALL ALWAYS emit one append record for every entry committed past the window maximum.

#### Scenario: A long conversation keeps every append

- **WHEN** T4.2 runs over a conversation of 150 entries
- **THEN** T4.2 SHALL emit 150 append records

### Requirement: A new attachment skips the snapshot

T4.6 SHALL ALWAYS prime from the acquisition value without a snapshot replay.

#### Scenario: A late client receives no snapshot

- **WHEN** T4.6 runs and a client attaches mid-run
- **THEN** T4.6 SHALL prime the client from the acquisition value

### Requirement: The event test precedes the release gate

T7.1 SHALL ALWAYS compare each routed record to the captured event fixture.

#### Scenario: The routed records match the fixture

- **WHEN** T7.1 runs
- **THEN** T7.1 SHALL compare each routed record to the captured event fixture

### Requirement: Acceptance terminates at quiescence

T7.2 SHALL ALWAYS terminate the acceptance stream at quiescence.

#### Scenario: The acceptance stream terminates

- **WHEN** T7.2 runs
- **THEN** T7.2 SHALL terminate the acceptance stream at quiescence
