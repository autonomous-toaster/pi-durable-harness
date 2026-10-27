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

## ADDED Requirements

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

T3.5 SHALL ALWAYS classify each extension capability as hosted or unsupported.

#### Scenario: Each capability gets one class

- **WHEN** T3.5 runs
- **THEN** T3.5 SHALL classify each extension capability as hosted or unsupported

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