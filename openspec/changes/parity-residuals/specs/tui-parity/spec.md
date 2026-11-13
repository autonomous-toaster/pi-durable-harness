## Task Reference

| T ID | Description |
| --- | --- |
| T1.4 | Hand the theme paths and the switch to both resource-loader constructions |
| T2.1 | Hand pi's interface the loader that carries a loaded theme |
| T2.2 | Start the interface on the selected theme |
| T3.1 | Construct the warmer from the runtime, the mode, and the projected branch |
| T3.2 | Start warming on every session request at the runtime durable is given |
| T3.3 | Settle, cancel, and reconcile the warmer with the turn and with a mode change |
| T3.4 | Answer the panel's cache-warming question from the warmer |
| T3.7 | Compare the cache-warming block with pi on a warmed run |
| T4.1 | Produce the session location in one value the panel and RPC share |
| T4.2 | Report a path for a local session and a storage identity for a PostgreSQL session |

## ADDED Requirements

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
