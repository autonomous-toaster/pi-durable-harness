# cli-prompt-modes Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T1.4 | Ignore a positional argument in explicit RPC mode |
| T1.5 | Pass the system prompt flags into the prompt extension |

## MODIFIED Requirements

### Requirement: RPC mode rejects a positional prompt

T1.4 SHALL ALWAYS serve RPC and ignore a positional argument when RPC mode is explicit.

#### Scenario: RPC mode rejects a positional prompt

- **WHEN** T1.4 runs with an explicit RPC mode and a positional argument
- **THEN** T1.4 SHALL serve RPC and ignore the argument

## ADDED Requirements

### Requirement: The system prompt flags reach the prompt

T1.5 SHALL ALWAYS render the replacement preamble and each addendum from the startup configuration.

#### Scenario: The flags shape the system prompt

- **WHEN** T1.5 runs with both system prompt flags
- **THEN** T1.5 SHALL render the replacement preamble followed by each addendum
