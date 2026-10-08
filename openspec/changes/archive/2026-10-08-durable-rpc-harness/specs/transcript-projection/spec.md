## Purpose

Defines how the harness produces pi-shaped session reads so that `get_entries`, `get_tree`, and `export_html` are faithful to pi while the durable entry model remains the source of truth.

## Task Reference

| T ID | Description |
| --- | --- |
| T5.1 | Implement the versioned projection adapter |
| T5.2 | Record control-plane transitions in an append-only log |
| T5.3 | Preserve unrecognized entry kinds verbatim |
| T5.4 | Implement the HTML export |

## ADDED Requirements

### Requirement: Projection precedes the control-plane log

T5.1 SHALL complete BEFORE T5.2 SHALL run.

#### Scenario: Control-plane log follows the projection

- **WHEN** T5.1 completes
- **THEN** T5.2 SHALL run

### Requirement: Control-plane log precedes preservation

T5.2 SHALL complete BEFORE T5.3 SHALL run.

#### Scenario: Preservation follows the control-plane log

- **WHEN** T5.2 completes
- **THEN** T5.3 SHALL run

### Requirement: Preservation precedes the HTML export

T5.3 SHALL complete BEFORE T5.4 SHALL run.

#### Scenario: HTML export follows preservation

- **WHEN** T5.3 completes
- **THEN** T5.4 SHALL run

### Requirement: Entries use pi session shapes

T5.1 SHALL ALWAYS return entries in pi session entry shapes.

#### Scenario: Entries use pi session shapes

- **WHEN** T5.1 runs
- **THEN** T5.1 SHALL return entries in pi session entry shapes

### Requirement: Control-plane transitions are ordered history

T5.2 SHALL ALWAYS record control-plane transitions as ordered history.

#### Scenario: Control-plane transitions are ordered

- **WHEN** T5.2 runs
- **THEN** T5.2 SHALL record control-plane transitions as ordered history

### Requirement: Unknown entry kinds are preserved

T5.3 SHALL ALWAYS preserve unrecognized entry kinds verbatim.

#### Scenario: Unknown entry kinds are preserved

- **WHEN** T5.3 runs
- **THEN** T5.3 SHALL preserve unrecognized entry kinds verbatim

### Requirement: The HTML export renders the transcript

T5.4 SHALL ALWAYS render messages, tool calls, and results.

#### Scenario: The HTML export renders the transcript

- **WHEN** T5.4 runs
- **THEN** T5.4 SHALL render messages, tool calls, and results

### Requirement: Output carries the projection version

T5.1 SHALL ALWAYS associate output with the targeted pi session-format version.

#### Scenario: Output carries the projection version

- **WHEN** T5.1 runs
- **THEN** T5.1 SHALL associate output with the targeted pi session-format version
