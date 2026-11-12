# pi-extension-host Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T6.1 | Run pi's runner beside the durable host for rendering |
| T6.2 | Execute each hook once on the durable host |

## ADDED Requirements

### Requirement: The renderer runner runs beside the host

T6.1 SHALL ALWAYS run pi's extension runner so its renderers, overlays, and widgets register.

#### Scenario: A tool row comes from the extension

- **WHEN** T6.1 runs with a fixture extension that registers a tool renderer
- **THEN** T6.1 SHALL let the extension draw that tool's row

### Requirement: The runner precedes the first render

T6.1 SHALL complete BEFORE T7.1 SHALL run.

#### Scenario: The TUI renders after the runner

- **WHEN** T6.1 completes
- **THEN** T7.1 SHALL run

### Requirement: Execution stays on the durable host

T6.2 SHALL ALWAYS execute each extension hook once, on the durable host.

#### Scenario: A blocking hook runs once

- **WHEN** T6.2 runs with a `tool_call` hook that blocks
- **THEN** T6.2 SHALL run the hook once and block the call
