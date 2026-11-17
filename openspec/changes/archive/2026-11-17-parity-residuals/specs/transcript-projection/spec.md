## Task Reference

| T ID | Description |
| --- | --- |
| T3.5 | Record a refresh's usage as a control entry and project it as pi's warm line |

## ADDED Requirements

### Requirement: A cache refresh appears in the transcript

T3.5 SHALL record a completed refresh BEFORE the transcript SHALL show that refresh.

#### Scenario: One refresh completes

- **WHEN** T3.5 records a refresh that cost money
- **THEN** the transcript SHALL show pi's warm line with that cost

#### Scenario: Consecutive refreshes

- **WHEN** T3.5 records two refreshes with no session request between
- **THEN** the transcript SHALL show one warm line whose cost is the sum

#### Scenario: A refresh carries no cost

- **WHEN** T3.5 records a refresh whose provider reported no cost
- **THEN** the transcript SHALL show the warm line without a total
