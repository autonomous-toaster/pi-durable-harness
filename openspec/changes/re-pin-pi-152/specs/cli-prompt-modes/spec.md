# cli-prompt-modes Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T6.1 | Read the progress window from the environment at startup |
| T6.2 | Pass the progress window to the harness settings as a live getter |
| T6.3 | Verify an immediate window stores each partial at once |
| T6.4 | Verify a deferred window holds the partial until the next read |

## ADDED Requirements

### Requirement: Startup reads the progress window

T6.1 SHALL ALWAYS read `PI_DURABLE_PERSIST_WITHIN_MS` at startup.

#### Scenario: The startup contract reads the variable

- **WHEN** T6.1 runs
- **THEN** T6.1 SHALL read `PI_DURABLE_PERSIST_WITHIN_MS` at startup

### Requirement: An invalid progress window falls back to zero

T6.1 SHALL ALWAYS fall back to zero and warn for an invalid value.

#### Scenario: A negative value warns and falls back

- **WHEN** T6.1 runs and the value is negative
- **THEN** T6.1 SHALL fall back to zero and warn

### Requirement: The settings bridge applies the window live

T6.2 SHALL ALWAYS read the progress window at each use.

#### Scenario: A changed value applies without restart

- **WHEN** T6.2 runs and the value changes
- **THEN** T6.2 SHALL apply the new value at the next use

### Requirement: An immediate window stores each partial

T6.3 SHALL ALWAYS store a partial answer as it arrives when the window is zero.

#### Scenario: A zero window stores the partial at once

- **WHEN** T6.3 runs with a window of zero
- **THEN** T6.3 SHALL store the partial answer as it arrives

### Requirement: A deferred window holds the partial

T6.4 SHALL ALWAYS hold a partial answer until the next document read when the window is large.

#### Scenario: A large window defers the partial

- **WHEN** T6.4 runs with a large window
- **THEN** T6.4 SHALL hold the partial until the next document read
