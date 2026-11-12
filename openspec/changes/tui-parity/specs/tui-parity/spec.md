## Purpose

Let pi's `InteractiveMode` run against durable state, so the terminal experience is pi's own while the session, its transcript, and its extensions are the harness's.

## Task Reference

| T ID | Description |
| --- | --- |
| T1.1 | Record each runtime member the TUI requests |
| T1.2 | Name the first member the runtime cannot satisfy |
| T3.1 | Serve the transcript reads from durable |
| T3.2 | Report the session identity get_state reports |
| T3.3 | Commit a label change to the transcript |
| T4.1 | Answer each state getter from durable state |
| T4.2 | Submit loop operations through durable submissions |
| T4.3 | Apply model and thinking operations to the durable agent |
| T4.4 | Read and write the active tool set through the registry |
| T5.1 | Emit each event from the durable view that carries it |
| T5.2 | Emit each unmodelled event from its own source |
| T7.1 | Exercise boot, prompt, tool render, and a selector |
| T7.2 | Document the TUI artifact and the dual extension runtime |

## ADDED Requirements

### Requirement: The spike precedes the adapter

T1.1 SHALL complete BEFORE T3.1 SHALL run.

#### Scenario: The adapter follows the measured surface

- **WHEN** T1.1 completes
- **THEN** T3.1 SHALL run

### Requirement: The spike records the requested surface

T1.1 SHALL ALWAYS record each runtime member the TUI requests.

#### Scenario: Every request is recorded

- **WHEN** T1.1 runs the TUI
- **THEN** T1.1 SHALL record each member the TUI requests

### Requirement: The spike names the first gap

T1.2 SHALL ALWAYS name the first member the runtime cannot satisfy.

#### Scenario: The first gap is named

- **WHEN** T1.2 runs a prompt through the TUI
- **THEN** T1.2 SHALL name the first unsatisfied member

### Requirement: Transcript reads come from durable

T3.1 SHALL ALWAYS serve `getEntries`, `getBranch`, `getTree`, and `buildContextEntries` from the durable transcript.

#### Scenario: The TUI sees the durable transcript

- **WHEN** T3.1 runs for one session
- **THEN** T3.1 SHALL serve the same entries `get_entries` reports

### Requirement: Session identity comes from the session model

T3.2 SHALL ALWAYS report the session id that `get_state` reports.

#### Scenario: The TUI shows the same session id

- **WHEN** T3.2 runs
- **THEN** T3.2 SHALL report the id `get_state` reports

### Requirement: A label change is a durable commit

T3.3 SHALL ALWAYS commit `appendLabelChange` to the durable transcript.

#### Scenario: A label appears in the transcript

- **WHEN** T3.3 runs a label change
- **THEN** T3.3 SHALL append a durable entry

### Requirement: State getters read durable state

T4.1 SHALL ALWAYS answer each state getter from durable state.

#### Scenario: The getters agree with RPC

- **WHEN** T4.1 answers a state getter
- **THEN** T4.1 SHALL answer what the equivalent RPC read reports

### Requirement: Loop operations submit durable input

T4.2 SHALL ALWAYS submit `prompt`, `steer`, `followUp`, `abort`, and `clearQueue` through durable submissions.

#### Scenario: A prompt round trip

- **WHEN** T4.2 runs a prompt from the TUI
- **THEN** T4.2 SHALL submit durable input and answer the run

### Requirement: Model operations reach the durable agent

T4.3 SHALL ALWAYS apply `setModel`, `setThinkingLevel`, and `setScopedModels` to the durable agent.

#### Scenario: A model change sticks

- **WHEN** T4.3 runs a model change
- **THEN** T4.3 SHALL configure the durable agent

### Requirement: Tool operations use the registry

T4.4 SHALL ALWAYS read and write the active tool set through the registry.

#### Scenario: A tool toggle sticks

- **WHEN** T4.4 toggles a tool
- **THEN** T4.4 SHALL declare the new set to the model

### Requirement: Event records follow durable views

T5.1 SHALL ALWAYS emit each event from the durable view that carries the event.

#### Scenario: A run produces the records in order

- **WHEN** T5.1 runs a prompt
- **THEN** T5.1 SHALL emit the records the TUI renders in that order

### Requirement: Unmodelled events come from their source

T5.2 SHALL ALWAYS emit each event durable does not model from its own source.

#### Scenario: A thinking change is reported

- **WHEN** T5.2 observes a thinking-level change
- **THEN** T5.2 SHALL emit a `thinking_level_changed` record

### Requirement: The parity test precedes the release

T7.1 SHALL ALWAYS exercise boot, prompt, tool render, and a selector.

#### Scenario: The TUI round trip passes

- **WHEN** T7.1 runs
- **THEN** T7.1 SHALL exercise a prompt, a tool row, and a selector

### Requirement: The TUI artifact is documented

T7.2 SHALL ALWAYS document the TUI artifact and the dual extension runtime in the README.

#### Scenario: The README describes the TUI

- **WHEN** T7.2 runs
- **THEN** T7.2 SHALL document the artifact and the dual extension runtime
