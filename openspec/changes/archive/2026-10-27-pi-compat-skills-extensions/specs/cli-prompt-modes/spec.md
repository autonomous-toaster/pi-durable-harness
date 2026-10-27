# cli-prompt-modes Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T1.2 | Install and build the bumped dependencies |
| T3.6 | Report a degraded extension on stderr |
| T3.7 | Install translated extensions into the engine |

## MODIFIED Requirements

### Requirement: Piped stdin prepends to the first prompt

T1.2 SHALL ALWAYS prepend piped stdin to the first prompt.

#### Scenario: Piped stdin prepends to the first prompt

- **WHEN** T1.2 runs
- **THEN** T1.2 SHALL prepend piped stdin to the first prompt

#### Scenario: A degraded extension is reported at startup

- **WHEN** T3.6 runs before an RPC or one-shot run
- **THEN** T3.6 SHALL write the degraded-extension diagnostic to stderr

## ADDED Requirements

### Requirement: Extension translation precedes startup

T3.7 SHALL complete BEFORE T1.2 SHALL run.


#### Scenario: Startup follows extension translation

- **WHEN** T3.7 completes
- **THEN** T1.2 SHALL run

### Requirement: Startup reports a degraded extension

T1.2 SHALL ALWAYS write each degraded-extension diagnostic to stderr at startup.

#### Scenario: Startup reports a degraded extension

- **WHEN** T1.2 runs
- **THEN** T1.2 SHALL write each degraded-extension diagnostic to stderr at startup