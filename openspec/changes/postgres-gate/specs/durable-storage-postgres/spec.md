## Task Reference

| T ID | Description |
| --- | --- |
| T1.1 | Run the framework's storage conformance suite against PostgreSQL in the gate |
| T1.2 | Fail the gate when the environment declares CI and no database is configured |
| T2.1 | Parse `bigint` per query instead of mutating the driver's parsers |
| T2.2 | Leave a released connection unscoped and destroy it |
| T3.1 | Read a multi-statement document from one committed snapshot |
| T5.1 | Document how to run the gate locally |

## ADDED Requirements

### Requirement: The backend is verified by the framework's own suite

T1.1 SHALL run the conformance suite BEFORE T1.2 SHALL report the gate's result.

#### Scenario: A change that breaks commit atomicity

- **WHEN** T1.1 runs the conformance suite against PostgreSQL
- **THEN** T1.1 SHALL fail on any case the suite covers, including a commit that does not roll back

#### Scenario: The parity cases run beside it

- **WHEN** T1.1 runs beside the parity suite
- **THEN** T1.1 SHALL compare the backend's observable behaviour with the reference storage

### Requirement: A declared gate cannot silently skip

T1.2 SHALL fail when the environment declares continuous integration AFTER T1.1 SHALL attempt to run.

#### Scenario: No database in CI

- **WHEN** T1.2 reads a CI environment without a database URL
- **THEN** T1.2 SHALL fail the check and name the missing variable

#### Scenario: No database on a developer machine

- **WHEN** T1.2 reads a local environment without a database URL
- **THEN** T1.2 SHALL skip the PostgreSQL cases and still pass the rest

### Requirement: The driver is not mutated for the process

T2.1 SHALL parse a `bigint` value AFTER T2.1 SHALL read it from a query.

#### Scenario: A host with its own PostgreSQL pool

- **WHEN** T2.1 reads an identity through the backend while the host's own pool uses the same driver
- **THEN** T2.1 SHALL answer a number without changing what the host's pool parses

### Requirement: A closed storage leaves nothing behind

T2.2 SHALL leave a released connection unscoped BEFORE T2.2 SHALL release the connection.

#### Scenario: The host owns the pool

- **WHEN** T2.2 closes a storage opened over a pool the host also uses
- **THEN** T2.2 SHALL drop the scope role and the session setting, and SHALL destroy the connection rather than return the connection to the pool

#### Scenario: A second writer after a close

- **WHEN** T2.2 has closed the first storage and a second writer opens the same session
- **THEN** T2.2 SHALL admit the second writer, because the ownership lock died with the connection

### Requirement: A document read observes one state

T3.1 SHALL read every statement of one document from one snapshot BEFORE T3.1 SHALL answer the document.

#### Scenario: A commit lands mid-read

- **WHEN** T3.1 reads a document whose base and revisions are two statements, and a commit lands between the base statement and the revisions statement
- **THEN** T3.1 SHALL answer the state committed when the read began

### Requirement: The gate is documented

T5.1 SHALL document how to run the gate AFTER T1.1 SHALL run the conformance suite.

#### Scenario: A developer runs the gate

- **WHEN** T5.1 documents the gate
- **THEN** T5.1 SHALL name the database variable the suite needs and what the suite proves


