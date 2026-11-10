# rpc-parity Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T5.1 | Read the built-in documents through Session document reads |
| T5.2 | Count messageCount over the full transcript |
| T5.3 | Project the full history for the session reads |

## ADDED Requirements

### Requirement: State reads the built-in documents

T5.1 SHALL ALWAYS read `pi.inbox` and `pi.live` through a Session document read.

#### Scenario: State reads the inbox and the live state

- **WHEN** T5.1 runs
- **THEN** T5.1 SHALL read `pi.inbox` and `pi.live` through a Session document read

### Requirement: State counts the full transcript

T5.2 SHALL ALWAYS count `messageCount` over the full transcript.

#### Scenario: A long conversation reports every message

- **WHEN** T5.2 runs over a conversation of 150 entries
- **THEN** T5.2 SHALL report 150 messages

### Requirement: Session reads project the full history

T5.3 SHALL ALWAYS project `get_entries`, `get_tree`, and `export_html` from the full transcript.

#### Scenario: A long conversation projects every entry

- **WHEN** T5.3 runs over a conversation of 150 entries
- **THEN** T5.3 SHALL project 150 entries
