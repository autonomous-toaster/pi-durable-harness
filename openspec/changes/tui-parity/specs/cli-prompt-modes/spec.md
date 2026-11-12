# cli-prompt-modes Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T2.1 | Ship the native module beside the TUI entry |
| T2.2 | Select the TUI on a terminal |

## ADDED Requirements

### Requirement: The TUI build resolves the native module

T2.1 SHALL ALWAYS load the `pi-tui` native module for the host platform before it reports a TUI build.

#### Scenario: The TUI build finds its module

- **WHEN** T2.1 runs on a supported platform
- **THEN** T2.1 SHALL load the native module the installed package ships

### Requirement: A terminal selects the TUI

T2.2 SHALL ALWAYS select the TUI when stdout is a terminal and the caller names no mode and no prompt.

#### Scenario: A terminal launch enters the TUI

- **WHEN** T2.2 runs with a terminal and no flag
- **THEN** T2.2 SHALL enter the TUI

#### Scenario: RPC mode stays RPC

- **WHEN** T2.2 runs with `--mode rpc`
- **THEN** T2.2 SHALL serve RPC and not the TUI
