# cli-prompt-modes Specification

## Purpose
Defines the one-shot CLI invocation modes the harness must support so that a positional prompt behaves as it does in pi: print the answer, stream JSON events, or exit with a status.

## Requirements

### Requirement: Prompt parsing precedes stdin prepending

T1.1 SHALL complete BEFORE T1.2 SHALL run.

#### Scenario: Stdin prepending follows prompt parsing

- **WHEN** T1.1 completes
- **THEN** T1.2 SHALL run

### Requirement: Prompt parsing precedes file resolution

T1.1 SHALL complete BEFORE T1.3 SHALL run.

#### Scenario: File resolution follows prompt parsing

- **WHEN** T1.1 completes
- **THEN** T1.3 SHALL run

### Requirement: Prompt parsing precedes mode dispatch

T1.1 SHALL complete BEFORE T2.1 SHALL run.

#### Scenario: Mode dispatch follows prompt parsing

- **WHEN** T1.1 completes
- **THEN** T2.1 SHALL run

### Requirement: Dispatch precedes the run

T2.1 SHALL complete BEFORE T2.2 SHALL run.

#### Scenario: The run follows dispatch

- **WHEN** T2.1 completes
- **THEN** T2.2 SHALL run

### Requirement: The run precedes print output

T2.2 SHALL complete BEFORE T2.3 SHALL run.

#### Scenario: Print output follows the run

- **WHEN** T2.2 completes
- **THEN** T2.3 SHALL run

### Requirement: The run precedes json output

T2.2 SHALL complete BEFORE T2.4 SHALL run.

#### Scenario: Json output follows the run

- **WHEN** T2.2 completes
- **THEN** T2.4 SHALL run

### Requirement: Prompt parsing precedes the RPC rejection

T1.1 SHALL complete BEFORE T2.5 SHALL run.

#### Scenario: The RPC rejection follows prompt parsing

- **WHEN** T1.1 completes
- **THEN** T2.5 SHALL run

### Requirement: Print output precedes the mode tests

T2.3 SHALL complete BEFORE T3.1 SHALL run.

#### Scenario: The mode tests follow print output

- **WHEN** T2.3 completes
- **THEN** T3.1 SHALL run

### Requirement: Json output precedes the mode tests

T2.4 SHALL complete BEFORE T3.1 SHALL run.

#### Scenario: The mode tests follow json output

- **WHEN** T2.4 completes
- **THEN** T3.1 SHALL run

### Requirement: The RPC rejection precedes the mode tests

T2.5 SHALL complete BEFORE T3.1 SHALL run.

#### Scenario: The mode tests follow the RPC rejection

- **WHEN** T2.5 completes
- **THEN** T3.1 SHALL run

### Requirement: A delimited argument is a prompt

T1.1 SHALL ALWAYS treat a `--`-delimited argument as a prompt.

#### Scenario: A delimited argument is a prompt

- **WHEN** T1.1 runs
- **THEN** T1.1 SHALL treat a `--`-delimited argument as a prompt

### Requirement: Piped stdin prepends to the first prompt

T1.2 SHALL ALWAYS prepend piped stdin to the first prompt.

#### Scenario: Piped stdin prepends to the first prompt

- **WHEN** T1.2 runs
- **THEN** T1.2 SHALL prepend piped stdin to the first prompt

### Requirement: A file reference resolves into the first prompt

T1.3 SHALL ALWAYS resolve an @path reference into the first prompt.

#### Scenario: A file reference resolves into the first prompt

- **WHEN** T1.3 runs
- **THEN** T1.3 SHALL resolve an @path reference into the first prompt

### Requirement: Json mode is selected by the json flag

T2.1 SHALL ALWAYS select json mode for the json mode flag.

#### Scenario: Json mode is selected by the json flag

- **WHEN** T2.1 runs
- **THEN** T2.1 SHALL select json mode for the json mode flag

### Requirement: Print mode is selected by the print flag

T2.1 SHALL ALWAYS select print mode for the print flag.

#### Scenario: Print mode is selected by the print flag

- **WHEN** T2.1 runs
- **THEN** T2.1 SHALL select print mode for the print flag

### Requirement: RPC mode is selected without a prompt

T2.1 SHALL ALWAYS select RPC mode without a positional prompt.

#### Scenario: RPC mode is selected without a prompt

- **WHEN** T2.1 runs
- **THEN** T2.1 SHALL select RPC mode without a positional prompt

### Requirement: The prompts run in order

T2.2 SHALL ALWAYS run the prompts in order.

#### Scenario: The prompts run in order

- **WHEN** T2.2 runs
- **THEN** T2.2 SHALL run the prompts in order

### Requirement: Print mode writes the final text

T2.3 SHALL ALWAYS write the final assistant text in print mode.

#### Scenario: Print mode writes the final text

- **WHEN** T2.3 runs
- **THEN** T2.3 SHALL write the final assistant text in print mode

### Requirement: Json mode writes a header and events

T2.4 SHALL ALWAYS write a session header and the session events in json mode.

#### Scenario: Json mode writes a header and events

- **WHEN** T2.4 runs
- **THEN** T2.4 SHALL write a session header and the session events in json mode

### Requirement: RPC mode rejects a positional prompt

T2.5 SHALL ALWAYS reject a positional prompt in RPC mode.

#### Scenario: RPC mode rejects a positional prompt

- **WHEN** T2.5 runs
- **THEN** T2.5 SHALL reject a positional prompt in RPC mode
