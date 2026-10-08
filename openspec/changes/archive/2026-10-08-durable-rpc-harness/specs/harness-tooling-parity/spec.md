## Purpose

Defines the tools, extensions, and resource loading the harness must expose so agents running on it have the same capabilities as agents running in pi.

## Task Reference

| T ID | Description |
| --- | --- |
| T7.1 | Port find, grep, ls, and the platform shell tool |
| T7.2 | Adapt the codemode extension |
| T7.3 | Adapt the tool-search extension |
| T7.4 | Adapt the MCP extension |
| T7.5 | Inject session metadata into shell tool commands |
| T8.1 | Reuse the model runtime, settings, and trust resolution |
| T8.2 | Align skills and instructions loading |

## ADDED Requirements

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
