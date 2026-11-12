# rpc-parity Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T1.1 | Resolve the session from an explicit id or create a new one |
| T1.2 | Open the newest session for continue |
| T1.3 | Refuse a session id that breaks pi's rule |
| T1.4 | Treat the name as a display name |
| T1.5 | Report the resolved session id in get_state |
| T1.6 | Scope the store by tenant |
| T4.1 | Exercise two sessions in one directory |

## ADDED Requirements

### Requirement: Startup resolves the session before the store opens

T1.1 SHALL ALWAYS resolve the session id from an explicit flag or mint a new one.

#### Scenario: No flag starts a new session

- **WHEN** T1.1 runs with no session flag
- **THEN** T1.1 SHALL mint a new session id

#### Scenario: An explicit id is opened or created

- **WHEN** T1.1 runs with a session id that exists
- **THEN** T1.1 SHALL open that session

### Requirement: Continue opens the newest session

T1.2 SHALL ALWAYS open the session with the greatest last use for the tenant and working directory.

#### Scenario: Continue picks the newest

- **WHEN** T1.2 runs with two sessions in one directory
- **THEN** T1.2 SHALL open the more recently used one

### Requirement: A session id follows pi's rule

T1.3 SHALL ALWAYS refuse a session id that does not start and end with a letter or a digit.

#### Scenario: A malformed id is refused

- **WHEN** T1.3 runs with an id that starts with a hyphen
- **THEN** T1.3 SHALL refuse it with a diagnostic

### Requirement: The name is not the identity

T1.4 SHALL ALWAYS treat the name as a display name.

#### Scenario: Two names share one session

- **WHEN** T1.4 runs twice with different names and one session id
- **THEN** T1.4 SHALL open the same session

### Requirement: State reports the resolved session id

T1.5 SHALL ALWAYS report the resolved session id as `get_state.sessionId`.

#### Scenario: A resumed session keeps its id

- **WHEN** T1.5 runs after a restart with the same session
- **THEN** T1.5 SHALL report the same id

### Requirement: The tenant scopes the store

T1.6 SHALL ALWAYS scope the store by the tenant named at startup.

#### Scenario: Two tenants never share a container

- **WHEN** T1.6 runs the same session id under two tenants
- **THEN** T1.6 SHALL open two containers

### Requirement: Concurrent sessions precede the release

T4.1 SHALL ALWAYS exercise two sessions in one working directory.

#### Scenario: Two sessions in one directory

- **WHEN** T4.1 runs two sessions in one directory
- **THEN** T4.1 SHALL report each session's own state
