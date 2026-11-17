## Task Reference

| T ID | Description |
| --- | --- |
| T4.1 | Produce the session location in one value the panel and RPC share |
| T4.3 | Verify a persisted session never reports an absent location |

## ADDED Requirements

### Requirement: A persisted session reports a location

T4.1 SHALL produce a location BEFORE the session status SHALL report the session.

#### Scenario: A local session

- **WHEN** T4.1 reads a session stored on disk
- **THEN** the status answer SHALL carry that file's path

#### Scenario: A PostgreSQL session

- **WHEN** T4.1 reads a session stored in PostgreSQL
- **THEN** the status answer SHALL carry the storage identity of that session

#### Scenario: An ephemeral session

- **WHEN** T4.1 reads a session that persists nothing
- **THEN** the status answer SHALL report no location

### Requirement: A persisted session never reports an absent location

T4.3 SHALL ALWAYS find a location on a session that persists entries.

#### Scenario: The field is filled

- **WHEN** T4.3 reads the status of a session that persists entries
- **THEN** T4.3 SHALL find a non-empty location
