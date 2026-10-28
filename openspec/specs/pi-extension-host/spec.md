# pi-extension-host Specification

## Purpose

Loads pi extensions into the durable engine and the harness, and reports which `ExtensionAPI` surfaces the harness hosts, so a client that installs a pi extension gets a defined subset and a named diagnostic for each surface the harness does not host.

## Task Reference

| T ID | Description |
| --- | --- |
| T3.1 | Load extensions with the resource loader |
| T3.2 | Translate registerTool to durable tools |
| T3.3 | Translate context and context_with_system to a beforeRequest hook |
| T3.4 | Map hosted lifecycle events to durable hooks |
| T3.5 | Classify each extension capability as hosted or unsupported |
| T3.6 | Report an unsupported surface on stderr |
| T3.7 | Install translated extensions into the engine |
| T3.8 | Forward registerProvider to the model runtime |
| T3.9 | Register extension commands in the harness command registry |
| T3.10 | Resolve a `/name` message on the prompt command |
| T3.11 | Consult the session-lifecycle veto points |
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

## Requirements

### Requirement: Extension loading precedes translation

T3.1 SHALL complete BEFORE T3.2 SHALL run.

#### Scenario: Translation follows loading

- **WHEN** T3.1 completes
- **THEN** T3.2 SHALL run

### Requirement: Translation precedes classification

T3.2 SHALL complete BEFORE T3.5 SHALL run.

#### Scenario: Classification follows translation

- **WHEN** T3.2 completes
- **THEN** T3.5 SHALL run

### Requirement: Classification precedes the surface report

T3.5 SHALL complete BEFORE T3.6 SHALL run.

#### Scenario: The surface report follows classification

- **WHEN** T3.5 completes
- **THEN** T3.6 SHALL run

### Requirement: The surface report precedes installation

T3.6 SHALL complete BEFORE T3.7 SHALL run.

#### Scenario: Installation follows the surface report

- **WHEN** T3.6 completes
- **THEN** T3.7 SHALL run

### Requirement: Classification precedes provider forwarding

T3.5 SHALL complete BEFORE T3.8 SHALL run.

#### Scenario: Provider forwarding follows classification

- **WHEN** T3.5 completes
- **THEN** T3.8 SHALL run

### Requirement: Classification precedes command registration

T3.5 SHALL complete BEFORE T3.9 SHALL run.

#### Scenario: Command registration follows classification

- **WHEN** T3.5 completes
- **THEN** T3.9 SHALL run

### Requirement: Command registration precedes resolution

T3.9 SHALL complete BEFORE T3.10 SHALL run.

#### Scenario: Resolution follows command registration

- **WHEN** T3.9 completes
- **THEN** T3.10 SHALL run

### Requirement: Command resolution precedes the veto consult

T3.10 SHALL complete BEFORE T3.11 SHALL run.

#### Scenario: The veto consult follows command resolution

- **WHEN** T3.10 completes
- **THEN** T3.11 SHALL run

### Requirement: Tools are translated

T3.2 SHALL ALWAYS translate each registered extension tool into one durable tool.

#### Scenario: A registered tool becomes a durable tool

- **WHEN** T3.2 runs
- **THEN** T3.2 SHALL translate each registered extension tool into one durable tool

### Requirement: Prompt context is translated

T3.3 SHALL ALWAYS translate each context or context_with_system handler into one beforeRequest hook.

#### Scenario: A context handler becomes a beforeRequest hook

- **WHEN** T3.3 runs
- **THEN** T3.3 SHALL translate each context or context_with_system handler into one beforeRequest hook

### Requirement: Hosted events are mapped to hooks

T3.4 SHALL ALWAYS map each hosted lifecycle event to one durable hook.

#### Scenario: A hosted event becomes a hook

- **WHEN** T3.4 runs
- **THEN** T3.4 SHALL map each hosted lifecycle event to one durable hook

### Requirement: Capabilities are classified

T11.1 SHALL ALWAYS classify each extension capability as hosted, inert, or unhosted.

#### Scenario: Each capability gets one class

- **WHEN** T11.1 runs
- **THEN** T11.1 SHALL classify each extension capability as hosted, inert, or unhosted

### Requirement: Provider registration is forwarded

T3.8 SHALL ALWAYS forward each `registerProvider` call to the model runtime.

#### Scenario: A provider registration reaches the model runtime

- **WHEN** T3.8 runs
- **THEN** T3.8 SHALL forward each `registerProvider` call to the model runtime

### Requirement: Extension commands are registered

T3.9 SHALL ALWAYS register each extension command in the harness command registry.

#### Scenario: An extension command is registered

- **WHEN** T3.9 runs
- **THEN** T3.9 SHALL register each extension command in the harness command registry

### Requirement: A command message is resolved

T3.10 SHALL ALWAYS resolve a `/name` message against the command registry.

#### Scenario: A command message is resolved

- **WHEN** T3.10 runs
- **THEN** T3.10 SHALL resolve a `/name` message against the command registry

### Requirement: The session vetoes are consulted

T3.11 SHALL ALWAYS consult the session-lifecycle handlers before a session change.

#### Scenario: A session change consults the vetoes

- **WHEN** T3.11 runs
- **THEN** T3.11 SHALL consult the session-lifecycle handlers before a session change

### Requirement: A veto cancels the session change

T3.11 SHALL ALWAYS cancel the session change when a handler returns `cancel`.

#### Scenario: A veto cancels the change

- **WHEN** T3.11 runs and a handler returns `cancel`
- **THEN** T3.11 SHALL cancel the session change

### Requirement: A veto is consulted before state is captured

T3.11 SHALL ALWAYS consult the vetoes before the session change captures state.

#### Scenario: The veto precedes the state capture

- **WHEN** T3.11 runs for a fork
- **THEN** T3.11 SHALL consult the vetoes before the fork captures state

### Requirement: An unsupported surface is reported

T3.6 SHALL ALWAYS report each unsupported surface on stderr.

#### Scenario: An unsupported surface is reported

- **WHEN** T3.6 runs
- **THEN** T3.6 SHALL report each unsupported surface on stderr

### Requirement: Translated extensions are installed

T3.7 SHALL ALWAYS install each translated extension into the registry.

#### Scenario: A translated extension is installed

- **WHEN** T3.7 runs
- **THEN** T3.7 SHALL install each translated extension into the registry

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
