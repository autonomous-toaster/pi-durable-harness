## Purpose

Defines the behavior of a PostgreSQL backend for Pi Durable's Storage interface so durable sessions can be persisted to a shared database.

## Task Reference

| T ID | Description |
| --- | --- |
| T2.1 | Define the PostgreSQL schema and migrations |
| T2.2 | Implement atomic commit with sequence and identifier ownership |
| T2.3 | Implement lookups and keyset scans with cursors |
| T2.4 | Implement document incarnations and revisions |
| T2.5 | Enforce cross-process single-writer with an advisory lock |
| T2.6 | Implement close and post-close rejection |
| T2.7 | Run the storage conformance suite against PostgreSQL |
| T9.3 | Verify that storage selection is invisible to the client |

## ADDED Requirements

### Requirement: Schema precedes commit

T2.1 SHALL complete BEFORE T2.2 SHALL run.

#### Scenario: Commit follows the schema

- **WHEN** T2.1 completes
- **THEN** T2.2 SHALL run

### Requirement: Commit precedes scans

T2.2 SHALL complete BEFORE T2.3 SHALL run.

#### Scenario: Scans follow commit

- **WHEN** T2.2 completes
- **THEN** T2.3 SHALL run

### Requirement: Scans precede documents

T2.3 SHALL complete BEFORE T2.4 SHALL run.

#### Scenario: Documents follow the scans

- **WHEN** T2.3 completes
- **THEN** T2.4 SHALL run

### Requirement: Documents precede locking

T2.4 SHALL complete BEFORE T2.5 SHALL run.

#### Scenario: Locking follows the documents

- **WHEN** T2.4 completes
- **THEN** T2.5 SHALL run

### Requirement: Locking precedes lifecycle

T2.5 SHALL complete BEFORE T2.6 SHALL run.

#### Scenario: Lifecycle follows the locking

- **WHEN** T2.5 completes
- **THEN** T2.6 SHALL run

### Requirement: Lifecycle precedes conformance

T2.6 SHALL complete BEFORE T2.7 SHALL run.

#### Scenario: Conformance follows the lifecycle

- **WHEN** T2.6 completes
- **THEN** T2.7 SHALL run

### Requirement: Conformance precedes the selection check

T2.7 SHALL complete BEFORE T9.3 SHALL run.

#### Scenario: Selection check follows conformance

- **WHEN** T2.7 completes
- **THEN** T9.3 SHALL run

### Requirement: Commit batches are atomic

T2.2 SHALL ALWAYS persist each commit batch atomically.

#### Scenario: A commit batch is atomic

- **WHEN** T2.2 runs
- **THEN** T2.2 SHALL persist each commit batch atomically

### Requirement: Sessions stay isolated

T2.1 SHALL ALWAYS keep each session's data isolated.

#### Scenario: Session data is isolated

- **WHEN** T2.1 runs
- **THEN** T2.1 SHALL keep each session's data isolated

### Requirement: Documents materialize from revisions

T2.4 SHALL ALWAYS materialize a document from its base and deltas.

#### Scenario: A document materializes

- **WHEN** T2.4 runs
- **THEN** T2.4 SHALL materialize a document from its base and deltas
