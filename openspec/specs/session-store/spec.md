# session-store Specification

## Purpose
Place one session's storage where its tenant and working directory can be found again, and answer which session in a directory was used most recently.

## Requirements

### Requirement: The container is the session

T2.1 SHALL ALWAYS place one session's storage in one container named by the tenant and the session id.

#### Scenario: Two sessions in one directory

- **WHEN** T2.1 runs two sessions in one directory
- **THEN** T2.1 SHALL create two containers

### Requirement: The SQLite path groups by working directory

T2.1 SHALL ALWAYS place a SQLite session under the working directory and the tenant that owns the session.

#### Scenario: A session file names its directory

- **WHEN** T2.1 opens a session in a directory
- **THEN** T2.1 SHALL write the session under that directory's path

### Requirement: The container precedes the catalog

T2.1 SHALL complete BEFORE T2.3 SHALL run.

#### Scenario: The catalog follows the container

- **WHEN** T2.1 completes
- **THEN** T2.3 SHALL run

### Requirement: One PostgreSQL schema holds every session

T2.2 SHALL ALWAYS open every session with a per-session prefix in the one configured schema.

#### Scenario: Two sessions share the schema

- **WHEN** T2.2 runs two sessions
- **THEN** T2.2 SHALL open two prefixes in one schema

### Requirement: The catalog records last use

T2.3 SHALL ALWAYS record the tenant, working directory, session id, and last use in the catalog when a session opens and when a run ends.

#### Scenario: A second launch refreshes last use

- **WHEN** T2.3 runs a second time for one session
- **THEN** T2.3 SHALL update that session's last use

### Requirement: SQLite recency is the file modification time

T2.4 SHALL ALWAYS derive SQLite recency from the session file's modification time.

#### Scenario: The newest file wins

- **WHEN** T2.4 compares two session files in one directory
- **THEN** T2.4 SHALL prefer the one modified last

### Requirement: The session model is documented

T4.2 SHALL ALWAYS document the session model, the continue flag, the tenant, and the storage layout in the README.

#### Scenario: The README describes the model

- **WHEN** T4.2 runs
- **THEN** T4.2 SHALL document the session model in the README
