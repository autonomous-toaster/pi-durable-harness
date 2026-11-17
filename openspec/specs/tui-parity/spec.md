# tui-parity Specification

## Purpose
Let pi's `InteractiveMode` run against durable state, so the terminal experience is pi's own while the session, its transcript, and its extensions are the harness's.

## Requirements

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

### Requirement: A loaded theme reaches the theme picker

T1.4 SHALL complete BEFORE T2.1 SHALL draw the resource panel.

#### Scenario: A theme file from the command line

- **WHEN** T1.4 loads a theme from `--theme`
- **THEN** T2.1 SHALL list that theme beside the built-in themes

### Requirement: The interface starts on the selected theme

T2.2 SHALL start the interface on the theme that the invocation selected BEFORE the interface SHALL draw a frame.

#### Scenario: A persisted selection with no flag

- **WHEN** T2.2 reads no theme selection and the settings hold one
- **THEN** T2.2 SHALL start on the stored theme

#### Scenario: A flag overrides the stored selection

- **WHEN** T2.2 reads a theme selection beside a stored theme
- **THEN** T2.2 SHALL start on the selected theme

### Requirement: A warmer serves the session surface

T3.1 SHALL construct one warmer for a session BEFORE T3.4 SHALL answer the panel.

#### Scenario: A session that can warm

- **WHEN** T3.1 constructs the warmer
- **THEN** T3.1 SHALL arm the warmer with the model runtime, the settings' warming mode, and the projected branch

### Requirement: A session request arms a refresh

T3.2 SHALL start warming AFTER T3.1 SHALL construct the warmer.

#### Scenario: The first session request

- **WHEN** T3.2 receives a session request
- **THEN** T3.2 SHALL hand that request to the warmer with the currency rule

#### Scenario: A request after a rewind

- **WHEN** T3.2 receives a request whose context no longer extends the armed request
- **THEN** T3.2 SHALL restart warming from the new request

### Requirement: A settled turn and a changed mode reach the warmer

T3.3 SHALL reconcile the warmer ALWAYS when a turn settles or the warming mode changes.

#### Scenario: A turn settles

- **WHEN** T3.3 reads a settled turn
- **THEN** T3.3 SHALL let the warmer schedule the refresh

#### Scenario: The mode changes

- **WHEN** T3.3 reads a changed warming mode
- **THEN** T3.3 SHALL let the warmer stop or resume the run for that mode

### Requirement: The info panel reports cache warming

T3.4 SHALL answer the panel's cache-warming question BEFORE the panel SHALL render that section.

#### Scenario: A session that warms

- **WHEN** T3.4 answers with a warming state
- **THEN** the panel SHALL print the mode, the state, and the decision the warmer holds

#### Scenario: A session that cannot warm

- **WHEN** T3.4 answers with no warming state
- **THEN** the panel SHALL print the line pi prints for an unavailable warmer

### Requirement: The warming section matches pi field for field

T3.7 SHALL compare the rendered section AFTER T3.4 SHALL answer the panel.

#### Scenario: Both interfaces warm the same session

- **WHEN** T3.7 renders the section beside pi's section for one warmed run
- **THEN** T3.7 SHALL find the same labels and the same values

### Requirement: The info panel states one session location

T4.2 SHALL read the storage of a session BEFORE T4.1 SHALL produce the location.

#### Scenario: A local session

- **WHEN** T4.2 reads a session stored on disk
- **THEN** T4.1 SHALL report the path of that file

#### Scenario: A PostgreSQL session

- **WHEN** T4.2 reads a session stored in PostgreSQL
- **THEN** T4.1 SHALL report the storage identity of that session

#### Scenario: The panel and RPC agree

- **WHEN** T4.1 reports a location
- **THEN** the panel line and the RPC answer SHALL carry the same string
