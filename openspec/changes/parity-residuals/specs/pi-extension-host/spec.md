## Task Reference

| T ID | Description |
| --- | --- |
| T3.6 | Apply an extension's cache-warming decision |
| T3.1 | Construct the warmer from the runtime, the mode, and the projected branch |

## ADDED Requirements

### Requirement: A warming decision applies

T3.6 SHALL ALWAYS apply the action an extension returns for `cache_warming_decision`.

#### Scenario: An extension stops warming

- **WHEN** T3.6 reads `stop` from a handler
- **THEN** T3.6 SHALL stop warming until the next session request

#### Scenario: An extension keeps warming

- **WHEN** T3.6 reads `warm` from a handler
- **THEN** T3.6 SHALL schedule the refresh that the warmer chose

### Requirement: A decision without a handler follows pi

T3.6 SHALL let the warmer decide BEFORE T3.1 SHALL schedule a refresh.

#### Scenario: No handler is installed

- **WHEN** T3.6 finds no handler for `cache_warming_decision`
- **THEN** T3.1 SHALL schedule the refresh the warmer chose

#### Scenario: A handler fails

- **WHEN** T3.6 reads a failure from a handler
- **THEN** T3.6 SHALL report the failure and SHALL use the warmer's own decision
