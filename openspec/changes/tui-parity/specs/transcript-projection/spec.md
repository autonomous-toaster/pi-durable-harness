# transcript-projection Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T3.1 | Serve the entry tree and context entries from durable |

## ADDED Requirements

### Requirement: The projection serves the tree and the context

T3.1 SHALL ALWAYS serve the session tree and the context entries from the durable projection.

#### Scenario: The tree and the context match the transcript

- **WHEN** T3.1 projects one session
- **THEN** T3.1 SHALL return the tree and the context entries that transcript implies
