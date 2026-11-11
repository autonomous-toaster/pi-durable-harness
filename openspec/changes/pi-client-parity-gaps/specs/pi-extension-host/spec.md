# pi-extension-host Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T2.1 | Connect each MCP server an extension registers |
| T2.2 | Report each extension MCP server that cannot connect |
| T5.1 | Pass the session view into each tool call |
| T5.2 | Build commands and session handlers from the same context |
| T5.3 | Report hasUI from the attached client |

## ADDED Requirements

### Requirement: Extension MCP servers are connected

T2.1 SHALL ALWAYS connect each MCP server that an extension registers.

#### Scenario: A registered server is connected

- **WHEN** T2.1 runs and an extension registers a server
- **THEN** T2.1 SHALL connect the server and declare the server's tools

### Requirement: An unconnected extension server is reported

T2.2 SHALL ALWAYS write one diagnostic naming each extension MCP server that cannot connect.

#### Scenario: A failed server is named

- **WHEN** T2.2 runs and an extension server cannot connect
- **THEN** T2.2 SHALL write a diagnostic naming that server

### Requirement: The tool context carries the session view

T5.1 SHALL ALWAYS pass the session view to each extension tool call.

#### Scenario: A tool reads the session id

- **WHEN** T5.1 runs and a tool reads the session id
- **THEN** T5.1 SHALL answer the id that `get_state` reports

### Requirement: The command context is complete

T5.2 SHALL ALWAYS pass a context with a UI and a session view to each extension command handler.

#### Scenario: A command notifies without throwing

- **WHEN** T5.2 runs and a command handler calls `ctx.ui.notify`
- **THEN** T5.2 SHALL complete the call

### Requirement: Session handlers share the command context

T5.2 SHALL ALWAYS pass the extension context to each session-lifecycle handler.

#### Scenario: A session handler reads the context

- **WHEN** T5.2 runs and a session handler reads the extension context
- **THEN** T5.2 SHALL pass the extension context an extension command receives

### Requirement: hasUI reports the attached client

T5.3 SHALL ALWAYS report `hasUI` from the attached client.

#### Scenario: No client means false

- **WHEN** T5.3 runs with no client attached
- **THEN** T5.3 SHALL report false
