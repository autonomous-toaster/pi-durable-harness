# harness-tooling-parity Specification

## Purpose
Defines the tools, extensions, and resource loading the harness must expose so agents running on it have the same capabilities as agents running in pi.

## Requirements

### Requirement: Built-in tools precede codemode

T7.1 SHALL complete BEFORE T7.2 SHALL run.

#### Scenario: Codemode follows the built-in tools

- **WHEN** T7.1 completes
- **THEN** T7.2 SHALL run

### Requirement: Codemode precedes tool search

T7.2 SHALL complete BEFORE T7.3 SHALL run.

#### Scenario: Tool search follows codemode

- **WHEN** T7.2 completes
- **THEN** T7.3 SHALL run

### Requirement: Tool search precedes MCP

T7.3 SHALL complete BEFORE T7.4 SHALL run.

#### Scenario: MCP follows tool search

- **WHEN** T7.3 completes
- **THEN** T7.4 SHALL run

### Requirement: MCP precedes shell metadata

T7.4 SHALL complete BEFORE T7.5 SHALL run.

#### Scenario: Shell metadata follows MCP

- **WHEN** T7.4 completes
- **THEN** T7.5 SHALL run

### Requirement: Shell metadata precedes runtime reuse

T7.5 SHALL complete BEFORE T8.1 SHALL run.

#### Scenario: Runtime reuse follows shell metadata

- **WHEN** T7.5 completes
- **THEN** T8.1 SHALL run

### Requirement: Runtime reuse precedes skill loading

T8.1 SHALL complete BEFORE T8.2 SHALL run.

#### Scenario: Skill loading follows runtime reuse

- **WHEN** T8.1 completes
- **THEN** T8.2 SHALL run

### Requirement: Built-in tools match pi

T7.1 SHALL ALWAYS expose the same built-in tools as pi.

#### Scenario: Built-in tools match pi

- **WHEN** T7.1 runs
- **THEN** T7.1 SHALL expose the same built-in tools as pi

### Requirement: Codemode composes tool calls

T7.2 SHALL ALWAYS let agents compose tool calls in a sandbox.

#### Scenario: Codemode composes tool calls

- **WHEN** T7.2 runs
- **THEN** T7.2 SHALL let agents compose tool calls in a sandbox

### Requirement: Tool search reveals deferred tools

T7.3 SHALL ALWAYS make a deferred tool available through search.

#### Scenario: Tool search reveals a deferred tool

- **WHEN** T7.3 runs
- **THEN** T7.3 SHALL make a deferred tool available through search

### Requirement: MCP failures stay contained

T7.4 SHALL ALWAYS surface a server failure without ending the session.

#### Scenario: MCP failures stay contained

- **WHEN** T7.4 runs
- **THEN** T7.4 SHALL surface a server failure without ending the session

### Requirement: Shell commands see session metadata

T7.5 SHALL ALWAYS expose session metadata to shell tool commands.

#### Scenario: Shell commands see session metadata

- **WHEN** T7.5 runs
- **THEN** T7.5 SHALL expose session metadata to shell tool commands

### Requirement: Model selection matches pi

T8.1 SHALL ALWAYS select the same default model and thinking level as pi.

#### Scenario: Model selection matches pi

- **WHEN** T8.1 runs
- **THEN** T8.1 SHALL select the same default model and thinking level as pi

### Requirement: Skills match pi

T8.2 SHALL ALWAYS make the same skills and instructions available as pi.

#### Scenario: Skills match pi

- **WHEN** T8.2 runs
- **THEN** T8.2 SHALL make the same skills and instructions available as pi

### Requirement: MCP tool exposure matches pi

T6.2 SHALL ALWAYS report no difference in MCP tool declarations.

#### Scenario: MCP tool exposure matches pi

- **WHEN** T6.2 runs
- **THEN** T6.2 SHALL report no difference in MCP tool declarations

### Requirement: Pinned version precedes the fixture capture

T1.1 SHALL complete BEFORE T1.3 SHALL run.

#### Scenario: Fixture capture follows the pinned version

- **WHEN** T1.1 completes
- **THEN** T1.3 SHALL run

### Requirement: Fixture capture precedes the fixture diff

T1.3 SHALL complete BEFORE T1.4 SHALL run.

#### Scenario: Fixture diff follows the capture

- **WHEN** T1.3 completes
- **THEN** T1.4 SHALL run

### Requirement: The pinned version matches pi

T1.1 SHALL ALWAYS pin each `@earendil-works/*` dependency to pi 1.4.0.

#### Scenario: The pin matches pi 1.4.0

- **WHEN** T1.1 runs
- **THEN** T1.1 SHALL pin each `@earendil-works/*` dependency to pi 1.4.0

### Requirement: The fixtures match the pinned version

T1.3 SHALL ALWAYS capture the golden fixtures from pi 1.4.0.

#### Scenario: The fixtures come from pi 1.4.0

- **WHEN** T1.3 runs
- **THEN** T1.3 SHALL capture the golden fixtures from pi 1.4.0

### Requirement: The re-baselined diff is clean

T1.4 SHALL ALWAYS report no unexpected event names or fields after the re-baseline.

#### Scenario: The re-baselined diff is clean

- **WHEN** T1.4 runs
- **THEN** T1.4 SHALL report no unexpected event names or fields after the re-baseline

### Requirement: Extension tools are exposed

T3.2 SHALL ALWAYS declare each translated extension tool to the model.

#### Scenario: A translated tool is declared

- **WHEN** T3.2 runs
- **THEN** T3.2 SHALL declare each translated extension tool to the model

### Requirement: The extension subset is documented

T3.5 SHALL ALWAYS limit the extension capability to the hosted subset.

#### Scenario: Only hosted extensions apply

- **WHEN** T3.5 runs
- **THEN** T3.5 SHALL limit the extension capability to the hosted subset

### Requirement: Extension providers reach the model runtime

T3.8 SHALL ALWAYS register each extension provider with the model runtime.

#### Scenario: An extension provider reaches the model runtime

- **WHEN** T3.8 runs
- **THEN** T3.8 SHALL register each extension provider with the model runtime

### Requirement: Extension commands are listed

T3.9 SHALL ALWAYS make each extension command available to the command set.

#### Scenario: An extension command is listed

- **WHEN** T3.9 runs
- **THEN** T3.9 SHALL make each extension command available to the command set

### Requirement: Session changes consult extensions

T3.11 SHALL ALWAYS consult the session-lifecycle handlers on a session command.

#### Scenario: A session command consults the handlers

- **WHEN** T3.11 runs
- **THEN** T3.11 SHALL consult the session-lifecycle handlers on a session command
