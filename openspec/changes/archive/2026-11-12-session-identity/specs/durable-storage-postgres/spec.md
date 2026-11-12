# durable-storage-postgres Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T3.1 | Open the storage with its prefix in the configured schema |
| T3.2 | Key the advisory lock by schema and prefix |

## ADDED Requirements

### Requirement: The facade opens a prefixed storage

T3.1 SHALL ALWAYS open the storage with its session prefix in the one configured schema.

#### Scenario: A prefixed storage opens in the schema

- **WHEN** T3.1 runs with a prefix
- **THEN** T3.1 SHALL create the prefixed tables in the configured schema

### Requirement: The prefix precedes the lock

T3.1 SHALL complete BEFORE T3.2 SHALL run.

#### Scenario: The lock follows the prefix

- **WHEN** T3.1 completes
- **THEN** T3.2 SHALL run

### Requirement: The lock covers schema and prefix

T3.2 SHALL ALWAYS key the advisory lock by the schema and the session prefix together.

#### Scenario: Two prefixes open together

- **WHEN** T3.2 runs two different prefixes in one schema
- **THEN** T3.2 SHALL admit both

#### Scenario: One prefix is refused twice

- **WHEN** T3.2 runs the same prefix twice
- **THEN** T3.2 SHALL refuse the second
