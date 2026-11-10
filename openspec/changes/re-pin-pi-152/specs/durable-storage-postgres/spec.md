# durable-storage-postgres Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T3.1 | Add runCounted to the PostgreSQL executor |
| T3.2 | Run the PostgreSQL conformance suite |
| T3.3 | Reopen a stored conversation under 1.5.2 |

## ADDED Requirements

### Requirement: The executor counts changed rows

T3.1 SHALL ALWAYS resolve `runCounted` with the number of changed rows.

#### Scenario: A counted statement reports its rows

- **WHEN** T3.1 runs a statement that changes two rows
- **THEN** T3.1 SHALL resolve with 2

### Requirement: The facade precedes the conformance suite

T3.1 SHALL complete BEFORE T3.2 SHALL run.

#### Scenario: Conformance follows the facade

- **WHEN** T3.1 completes
- **THEN** T3.2 SHALL run

### Requirement: A stored conversation reopens

T3.3 SHALL ALWAYS resume a stored conversation under pi-durable 1.5.2.

#### Scenario: A stored conversation resumes

- **WHEN** T3.3 runs and a conversation was stored earlier
- **THEN** T3.3 SHALL resume the conversation under pi-durable 1.5.2
