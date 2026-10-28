# pi-extension-host Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T9.1 | Build the serialized event dispatch bus |
| T9.2 | Dispatch events from the projected session stream |
| T9.3 | Dispatch events from the RPC commands |
| T9.4 | Apply the input handler text result |
| T9.5 | Contain a throwing handler to a diagnostic |
| T10.1 | Install the durable-backed action surface |
| T10.2 | Serve a synchronous session snapshot |
| T10.3 | Apply extension flags from the arguments |
| T10.4 | Apply discovered resource paths |
| T11.1 | Classify surfaces as hosted, inert, or unhosted |
| T11.2 | Accept an inert surface without a diagnostic |
| T11.3 | Report an unapplied handler result |
| T11.4 | Report an unhosted surface on stderr |

## MODIFIED Requirements

### Requirement: Capabilities are classified

T11.1 SHALL ALWAYS classify each extension capability as hosted, inert, or unhosted.

#### Scenario: Each capability gets one class

- **WHEN** T11.1 runs
- **THEN** T11.1 SHALL classify each extension capability as hosted, inert, or unhosted

## ADDED Requirements

### Requirement: The bus precedes stream dispatch

T9.1 SHALL complete BEFORE T9.2 SHALL run.

#### Scenario: Stream dispatch follows the bus

- **WHEN** T9.1 completes
- **THEN** T9.2 SHALL run

### Requirement: The bus precedes command dispatch

T9.1 SHALL complete BEFORE T9.3 SHALL run.

#### Scenario: Command dispatch follows the bus

- **WHEN** T9.1 completes
- **THEN** T9.3 SHALL run

### Requirement: Stream dispatch precedes command dispatch

T9.2 SHALL complete BEFORE T9.3 SHALL run.

#### Scenario: Command dispatch follows stream dispatch

- **WHEN** T9.2 completes
- **THEN** T9.3 SHALL run

### Requirement: Dispatch precedes input application

T9.1 SHALL complete BEFORE T9.4 SHALL run.

#### Scenario: Input application follows the bus

- **WHEN** T9.1 completes
- **THEN** T9.4 SHALL run

### Requirement: The action surface precedes flags

T10.1 SHALL complete BEFORE T10.3 SHALL run.

#### Scenario: Flag application follows the action surface

- **WHEN** T10.1 completes
- **THEN** T10.3 SHALL run

### Requirement: Discovery precedes resource application

T10.1 SHALL complete BEFORE T10.4 SHALL run.

#### Scenario: Resource application follows discovery

- **WHEN** T10.1 completes
- **THEN** T10.4 SHALL run

### Requirement: Classification precedes the report

T11.1 SHALL complete BEFORE T11.4 SHALL run.

#### Scenario: The report follows classification

- **WHEN** T11.1 completes
- **THEN** T11.4 SHALL run

### Requirement: Events are dispatched in session order

T9.1 SHALL ALWAYS run each handler after the previous handler completes.

#### Scenario: Handlers run one at a time

- **WHEN** T9.1 runs two dispatches
- **THEN** T9.1 SHALL run each handler after the previous handler completes

### Requirement: Stream events reach handlers

T9.2 SHALL ALWAYS dispatch each projected session record to its handlers.

#### Scenario: A projected record reaches its handler

- **WHEN** T9.2 runs
- **THEN** T9.2 SHALL dispatch each projected session record to its handlers

### Requirement: Command events reach handlers

T9.3 SHALL ALWAYS dispatch the model, thinking, session-info, tree, and bash events from their commands.

#### Scenario: A model change reaches its handler

- **WHEN** T9.3 runs a model change
- **THEN** T9.3 SHALL dispatch the model event from its command

### Requirement: The input result replaces the text

T9.4 SHALL ALWAYS replace the message with the input handler text result.

#### Scenario: The input result replaces the text

- **WHEN** T9.4 runs and a handler returns text
- **THEN** T9.4 SHALL replace the message with the input handler text result

### Requirement: A throwing handler is contained

T9.5 SHALL ALWAYS write a diagnostic when a handler throws.

#### Scenario: A throwing handler is reported

- **WHEN** T9.5 runs and a handler throws
- **THEN** T9.5 SHALL write a diagnostic

### Requirement: The run survives a throwing handler

T9.5 SHALL ALWAYS keep the run alive after a handler throws.

#### Scenario: The run survives a throw

- **WHEN** T9.5 runs and a handler throws
- **THEN** T9.5 SHALL keep the run alive

### Requirement: The action surface reaches durable

T10.1 SHALL ALWAYS apply each action to the durable session.

#### Scenario: An action reaches the session

- **WHEN** T10.1 runs an action
- **THEN** T10.1 SHALL apply each action to the durable session

### Requirement: The session view is synchronous

T10.2 SHALL ALWAYS serve the session view without awaiting durable.

#### Scenario: A handler reads the session view synchronously

- **WHEN** T10.2 runs
- **THEN** T10.2 SHALL serve the session view without awaiting durable

### Requirement: Flags come from the arguments

T10.3 SHALL ALWAYS set each registered flag from the process arguments.

#### Scenario: A flag is read from the arguments

- **WHEN** T10.3 runs with a flag argument
- **THEN** T10.3 SHALL set each registered flag from the process arguments

### Requirement: Discovered paths reach the resource loader

T10.4 SHALL ALWAYS load each discovered skill and template path.

#### Scenario: A discovered skill path is loaded

- **WHEN** T10.4 runs
- **THEN** T10.4 SHALL load each discovered skill and template path

### Requirement: An inert surface is accepted

T11.2 SHALL NOT report an inert surface.

#### Scenario: An inert surface is not reported

- **WHEN** T11.2 runs
- **THEN** T11.2 SHALL NOT report an inert surface

### Requirement: An unapplied result is reported

T11.3 SHALL ALWAYS report a handler result the harness cannot apply.

#### Scenario: An unapplied result is reported

- **WHEN** T11.3 runs and a handler returns an unapplied field
- **THEN** T11.3 SHALL report the unapplied result
