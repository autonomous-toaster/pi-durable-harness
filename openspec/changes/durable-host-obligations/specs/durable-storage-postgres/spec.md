## Task Reference

| T ID | Description |
| --- | --- |
| T5.1 | Throttle the catalog stamp |
| T5.2 | Record the storage calls one turn costs |

## ADDED Requirements

### Requirement: A turn does not spend a stamp it does not need

T5.1 SHALL keep a catalog stamp at most once per minute BEFORE T5.2 SHALL count the calls of a turn.

#### Scenario: Two prompts in one minute

- **WHEN** T5.1 writes the catalog stamp for a second prompt inside the same minute
- **THEN** T5.1 SHALL write no stamp for that prompt

#### Scenario: A resume after a long pause

- **WHEN** T5.1 reads a stamp older than one minute
- **THEN** T5.1 SHALL write the stamp so `--continue` finds the session

### Requirement: The calls one turn costs are recorded

T5.2 SHALL record the storage calls one turn costs AFTER T5.1 SHALL throttle the stamp.

#### Scenario: A single-tool-call turn

- **WHEN** T5.2 measures a turn that calls one tool and answers
- **THEN** T5.2 SHALL record the calls and the writes the turn spent, beside the read budget
