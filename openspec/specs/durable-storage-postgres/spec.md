# durable-storage-postgres Specification

## Purpose
Define how the PostgreSQL backend resolves the server it connects to, the credentials it presents, and the transport it requires, so a prefixed setting, a standard libpq name, and a URL compose in one stated order.

## Requirements

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

### Requirement: The prefixed name precedes the standard name

T1.1 SHALL read a prefixed connection name BEFORE T1.1 SHALL read the standard name of the same field.

#### Scenario: A prefixed password wins

- **WHEN** T1.1 reads `PI_DURABLE_PGPASSWORD` and `PGPASSWORD` together
- **THEN** T1.1 SHALL present the prefixed value to the server

#### Scenario: A standard name still serves its field

- **WHEN** T1.1 reads `PGPASSWORD` alone
- **THEN** T1.1 SHALL present that value to the server

### Requirement: The prefix carries the exact standard name

T1.2 SHALL ALWAYS derive a prefixed name by adding `PI_DURABLE_` to the standard name and nothing else.

#### Scenario: One mapping serves every field

- **WHEN** T1.2 derives the prefixed form of `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`, `PGSSLROOTCERT`, `PGSSLCERT`, `PGSSLKEY`, `PGOPTIONS`, `PGAPPNAME`, and `PGCONNECT_TIMEOUT`
- **THEN** T1.2 SHALL produce the standard name behind the prefix for each field

### Requirement: One resolution serves both pools

T1.1 SHALL complete BEFORE T1.3 SHALL run.

#### Scenario: The pools share one record

- **WHEN** T1.1 completes
- **THEN** T1.3 SHALL connect the session pool and the catalog pool from that record

### Requirement: The password may live outside the URL

T1.4 SHALL ALWAYS resolve the password from the standard name when the URL carries none.

#### Scenario: A URL without a password

- **WHEN** T1.4 reads a URL that names host, port, user, and database, and reads `PGPASSWORD`
- **THEN** T1.4 SHALL present the environment password to the server

### Requirement: The renamed TLS settings precede the encrypted check

T2.1 SHALL complete BEFORE T2.5 SHALL run.

#### Scenario: The decision reads the new spellings

- **WHEN** T2.1 completes
- **THEN** T2.5 SHALL read the mode from `PI_DURABLE_PGSSLMODE` and the authority from `PI_DURABLE_PGSSLROOTCERT`

### Requirement: An opportunistic TLS mode precedes any connection

T2.2 SHALL refuse `allow` and `prefer` BEFORE T2.5 SHALL run.

#### Scenario: A fallback mode is refused

- **WHEN** T2.2 reads `allow` or `prefer`
- **THEN** T2.2 SHALL refuse the connection and name the accepted modes

### Requirement: A verifying TLS mode precedes the connection

T2.3 SHALL refuse a verifying mode with no root certificate BEFORE T2.5 SHALL run.

#### Scenario: A verifying mode without an authority

- **WHEN** T2.3 reads `verify-ca` or `verify-full` and no root certificate path
- **THEN** T2.3 SHALL refuse the connection and name `PI_DURABLE_PGSSLROOTCERT`

### Requirement: The TLS mode is the only statement of the requirement

T2.4 SHALL complete BEFORE T5.1 SHALL run.

#### Scenario: The removed variable is documented nowhere

- **WHEN** T2.4 completes
- **THEN** T5.1 SHALL describe the TLS mode as the only statement of the encrypted requirement

### Requirement: An unencrypted connection is always refused

T2.5 SHALL ALWAYS report a connection that is not encrypted as an error.

#### Scenario: A server answers in clear text

- **WHEN** T2.5 reads a connection that reports no encryption
- **THEN** T2.5 SHALL refuse the session

### Requirement: A prefixed setting selects the backend

T3.1 SHALL select PostgreSQL BEFORE T1.1 SHALL resolve a connection field.

#### Scenario: A prefixed host with no URL

- **WHEN** T3.1 reads `PI_DURABLE_PGHOST` or `PI_DURABLE_PG` and no URL
- **THEN** T3.1 SHALL store the session in PostgreSQL

### Requirement: A standard name does not select the backend

T3.2 SHALL ALWAYS keep a standard connection name from selecting PostgreSQL.

#### Scenario: A stray standard name

- **WHEN** T3.2 reads `PGHOST` alone
- **THEN** T3.2 SHALL store the session in SQLite

### Requirement: A local flag does not select the backend

T3.2 SHALL ALWAYS keep `--no-session` and `--session-dir` on local storage.

#### Scenario: A local flag beside a prefixed host

- **WHEN** T3.2 reads `--no-session` and a prefixed host together
- **THEN** T3.2 SHALL keep the session local

### Requirement: The session option follows the inherited options

T4.1 SHALL place the inherited connection options BEFORE T4.1 SHALL place the session option.

#### Scenario: A caller cannot replace the session scope

- **WHEN** T4.1 reads `PGOPTIONS` and opens a session
- **THEN** T4.1 SHALL pass the inherited options first and the session option last

### Requirement: The documentation covers every prefixed name

T5.1 SHALL ALWAYS document the mapping of every prefixed name that T1.2 SHALL derive.

#### Scenario: A reader finds a name in the table

- **WHEN** T5.1 documents the mapping table
- **THEN** T5.1 SHALL list each prefixed connection name beside its standard name

### Requirement: The help text names the current spellings

T5.1 SHALL complete BEFORE T5.1 SHALL print the environment list in `--help`.

#### Scenario: The old spellings are absent

- **WHEN** T5.1 prints the environment list
- **THEN** T5.1 SHALL print `PI_DURABLE_PGSSLMODE` and SHALL NOT print `PI_DURABLE_PG_SSL`
