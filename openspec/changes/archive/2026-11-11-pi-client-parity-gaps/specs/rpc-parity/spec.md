# rpc-parity Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T1.1 | Record the system prompt flags in the startup configuration |
| T1.2 | Cover every flag pi parses with a value |
| T1.3 | Resolve a file-valued argument to the file's contents |
| T4.1 | Launch the harness with the documented client argv |

## ADDED Requirements

### Requirement: The system prompt flags reach the configuration

T1.1 SHALL ALWAYS record `--system-prompt` and each `--append-system-prompt` in the startup configuration.

#### Scenario: Both system prompt flags are recorded

- **WHEN** T1.1 runs with both flags
- **THEN** T1.1 SHALL record the replacement text and each appended text

### Requirement: The value-flag table covers pi's parser

T1.2 SHALL ALWAYS include every flag that pi 1.5.2 parses with a value.

#### Scenario: Every value flag is known

- **WHEN** T1.2 runs over pi's value-taking flags
- **THEN** T1.2 SHALL include each one with a value slot

### Requirement: A file-valued argument resolves to the file's contents

T1.3 SHALL ALWAYS read a flag value that names an existing file.

#### Scenario: A path becomes the file's contents

- **WHEN** T1.3 runs and the value names an existing file
- **THEN** T1.3 SHALL read the file contents in place of the path

### Requirement: The client startup test precedes the release

T4.1 SHALL ALWAYS launch the harness with the documented client argv.

#### Scenario: The documented argv serves RPC

- **WHEN** T4.1 runs with the documented argv
- **THEN** T4.1 SHALL receive an RPC response
