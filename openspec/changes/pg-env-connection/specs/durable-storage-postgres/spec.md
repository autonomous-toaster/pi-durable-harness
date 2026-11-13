## Purpose

Define how the PostgreSQL backend resolves the server it connects to, the credentials it presents, and the transport it requires, so a prefixed setting, a standard libpq name, and a URL compose in one stated order.

## Task Reference

| T ID | Description |
| --- | --- |
| T1.1 | Resolve one connection field from the prefixed name, the standard name, the URL, then a default |
| T1.2 | Derive the prefixed name by adding `PI_DURABLE_` to the standard name |
| T1.3 | Resolve the session pool and the catalog pool from one record |
| T1.4 | Resolve the password from the environment when the URL omits it |
| T2.1 | Read the TLS mode and certificates from the renamed spellings |
| T2.2 | Refuse `allow` and `prefer` |
| T2.3 | Refuse a verifying mode without a root certificate |
| T2.4 | Delete the separate encrypted-connection variable |
| T2.5 | Report an unencrypted connection as an error |
| T3.1 | Select PostgreSQL from a prefixed setting |
| T3.2 | Keep a standard name and a local flag from selecting PostgreSQL |
| T4.1 | Merge inherited options with the session option, ours last |
| T5.1 | Document the mapping, the ladder, and the renames |

## ADDED Requirements

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
