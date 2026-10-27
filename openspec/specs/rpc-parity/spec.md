# rpc-parity Specification

## Purpose
Defines the client-facing pi-RPC JSONL contract the harness must honor so any existing pi RPC client can drive the harness as a transparent drop-in for the `pi --mode rpc` process.

## Requirements

### Requirement: Package precedes dependencies

T1.1 SHALL complete BEFORE T1.2 SHALL run.

#### Scenario: Dependencies follow the package

- **WHEN** T1.1 completes
- **THEN** T1.2 SHALL run

### Requirement: Fixtures precede CI

T1.3 SHALL complete BEFORE T1.4 SHALL run.

#### Scenario: CI follows the fixture corpus

- **WHEN** T1.3 completes
- **THEN** T1.4 SHALL run

### Requirement: CI precedes the release build

T1.4 SHALL complete BEFORE T1.5 SHALL run.

#### Scenario: Release build follows CI

- **WHEN** T1.4 completes
- **THEN** T1.5 SHALL run

### Requirement: Dependencies precede the entry markers

T1.2 SHALL complete BEFORE T1.6 SHALL run.

#### Scenario: Entry markers follow the dependencies

- **WHEN** T1.2 completes
- **THEN** T1.6 SHALL run

### Requirement: Framing precedes dispatch

T3.1 SHALL complete BEFORE T3.2 SHALL run.

#### Scenario: Dispatch follows framing

- **WHEN** T3.1 completes
- **THEN** T3.2 SHALL run

### Requirement: Dispatch precedes the state reads

T3.2 SHALL complete BEFORE T3.3 SHALL run.

#### Scenario: State reads follow dispatch

- **WHEN** T3.2 completes
- **THEN** T3.3 SHALL run

### Requirement: State reads precede the startup contract

T3.3 SHALL complete BEFORE T3.4 SHALL run.

#### Scenario: Startup contract follows the state reads

- **WHEN** T3.3 completes
- **THEN** T3.4 SHALL run

### Requirement: Dispatch precedes image mapping

T3.2 SHALL complete BEFORE T3.5 SHALL run.

#### Scenario: Image mapping follows dispatch

- **WHEN** T3.2 completes
- **THEN** T3.5 SHALL run

### Requirement: Lifecycle events precede the message events

T4.1 SHALL complete BEFORE T4.2 SHALL run.

#### Scenario: Message events follow the lifecycle events

- **WHEN** T4.1 completes
- **THEN** T4.2 SHALL run

### Requirement: Message events precede the tool events

T4.2 SHALL complete BEFORE T4.3 SHALL run.

#### Scenario: Tool events follow the message events

- **WHEN** T4.2 completes
- **THEN** T4.3 SHALL run

### Requirement: Tool events precede the queue events

T4.3 SHALL complete BEFORE T4.4 SHALL run.

#### Scenario: Queue events follow the tool events

- **WHEN** T4.3 completes
- **THEN** T4.4 SHALL run

### Requirement: Queue events precede settle synthesis

T4.4 SHALL complete BEFORE T4.5 SHALL run.

#### Scenario: Settle synthesis follows the queue events

- **WHEN** T4.4 completes
- **THEN** T4.5 SHALL run

### Requirement: Settle synthesis precedes snapshot priming

T4.5 SHALL complete BEFORE T4.6 SHALL run.

#### Scenario: Snapshot priming follows settle synthesis

- **WHEN** T4.5 completes
- **THEN** T4.6 SHALL run

### Requirement: Run-policy storage precedes the session commands

T6.1 SHALL complete BEFORE T6.2 SHALL run.

#### Scenario: Session commands follow run-policy storage

- **WHEN** T6.1 completes
- **THEN** T6.2 SHALL run

### Requirement: Session commands precede direct bash

T6.2 SHALL complete BEFORE T6.3 SHALL run.

#### Scenario: Direct bash follows the session commands

- **WHEN** T6.2 completes
- **THEN** T6.3 SHALL run

### Requirement: Direct bash precedes the model commands

T6.3 SHALL complete BEFORE T6.4 SHALL run.

#### Scenario: Model commands follow direct bash

- **WHEN** T6.3 completes
- **THEN** T6.4 SHALL run

### Requirement: Model commands precede the command registry

T6.4 SHALL complete BEFORE T6.5 SHALL run.

#### Scenario: Command registry follows the model commands

- **WHEN** T6.4 completes
- **THEN** T6.5 SHALL run

### Requirement: Fixture diff precedes the acceptance run

T9.1 SHALL complete BEFORE T9.2 SHALL run.

#### Scenario: Acceptance run follows the fixture diff

- **WHEN** T9.1 completes
- **THEN** T9.2 SHALL run

### Requirement: Framing writes one record per line

T3.1 SHALL ALWAYS terminate each record with one line feed.

#### Scenario: Records end with one line feed

- **WHEN** T3.1 runs
- **THEN** T3.1 SHALL terminate each record with one line feed

### Requirement: Diagnostics stay on stderr

T3.1 SHALL ALWAYS write diagnostics only to stderr.

#### Scenario: Diagnostics avoid stdout

- **WHEN** T3.1 runs
- **THEN** T3.1 SHALL write diagnostics only to stderr

### Requirement: One response per command

T3.2 SHALL ALWAYS answer each command with one response.

#### Scenario: Every command gets one response

- **WHEN** T3.2 runs
- **THEN** T3.2 SHALL answer each command with one response

### Requirement: Responses repeat the command identifier

T3.2 SHALL ALWAYS repeat the command identifier in its response.

#### Scenario: Response repeats the identifier

- **WHEN** T3.2 runs
- **THEN** T3.2 SHALL repeat the command identifier in its response

### Requirement: Extension UI responses are ignored

T3.2 SHALL ALWAYS ignore extension UI responses.

#### Scenario: Extension UI response is ignored

- **WHEN** T3.2 runs
- **THEN** T3.2 SHALL ignore extension UI responses

### Requirement: State reports the session identifier

T3.3 SHALL ALWAYS report the harness session identifier.

#### Scenario: State carries the session identifier

- **WHEN** T3.3 runs
- **THEN** T3.3 SHALL report the harness session identifier

### Requirement: State reports a null session file for database-backed storage

T3.3 SHALL ALWAYS report a null session file for a database-backed session.

#### Scenario: State carries a null session file

- **WHEN** T3.3 runs
- **THEN** T3.3 SHALL report a null session file for a database-backed session

### Requirement: State omits the session file when ephemeral

T3.3 SHALL ALWAYS omit the session file for an ephemeral session.

#### Scenario: State omits the session file

- **WHEN** T3.3 runs
- **THEN** T3.3 SHALL omit the session file for an ephemeral session

### Requirement: Malformed input gets one error response

T3.2 SHALL ALWAYS answer malformed input with one error response.

#### Scenario: Malformed input is rejected

- **WHEN** T3.2 runs
- **THEN** T3.2 SHALL answer malformed input with one error response

### Requirement: Startup accepts pi flags and variables

T3.4 SHALL ALWAYS accept pi's CLI flags and environment variables.

#### Scenario: Startup uses pi's flags and variables

- **WHEN** T3.4 runs
- **THEN** T3.4 SHALL accept pi's CLI flags and environment variables

### Requirement: Image content reaches the model

T3.5 SHALL ALWAYS pass image content to the model.

#### Scenario: Image content reaches the model

- **WHEN** T3.5 runs
- **THEN** T3.5 SHALL pass image content to the model

### Requirement: Lifecycle events are reported

T4.1 SHALL ALWAYS report run lifecycle changes.

#### Scenario: Lifecycle changes are reported

- **WHEN** T4.1 runs
- **THEN** T4.1 SHALL report run lifecycle changes

### Requirement: Message updates stay one per change

T4.2 SHALL ALWAYS emit one assistant message event per change.

#### Scenario: One message event per change

- **WHEN** T4.2 runs
- **THEN** T4.2 SHALL emit one assistant message event per change

### Requirement: Tool output accumulates into partial results

T4.3 SHALL ALWAYS accumulate tool output into partial results.

#### Scenario: Tool output accumulates

- **WHEN** T4.3 runs
- **THEN** T4.3 SHALL accumulate tool output into partial results

### Requirement: Compaction results are reported

T4.4 SHALL ALWAYS report the compaction result or abort.

#### Scenario: Compaction result is reported

- **WHEN** T4.4 runs
- **THEN** T4.4 SHALL report the compaction result or abort

### Requirement: Settle is reported at quiescence

T4.5 SHALL ALWAYS report agent_settled at quiescence.

#### Scenario: Settle is reported at quiescence

- **WHEN** T4.5 runs
- **THEN** T4.5 SHALL report agent_settled at quiescence

### Requirement: New attachments skip the snapshot

T4.6 SHALL ALWAYS prime a new attachment without a snapshot replay.

#### Scenario: New attachments skip the snapshot

- **WHEN** T4.6 runs
- **THEN** T4.6 SHALL prime a new attachment without a snapshot replay

### Requirement: Run policy is applied

T6.1 SHALL ALWAYS apply the stored steering and follow-up modes.

#### Scenario: Run policy is applied

- **WHEN** T6.1 runs
- **THEN** T6.1 SHALL apply the stored steering and follow-up modes

### Requirement: Fork and clone preserve history

T6.2 SHALL ALWAYS preserve history on fork and clone.

#### Scenario: History survives fork and clone

- **WHEN** T6.2 runs
- **THEN** T6.2 SHALL preserve history on fork and clone

### Requirement: Bash output repeats the command identifier

T6.3 SHALL ALWAYS repeat the command identifier in bash output events.

#### Scenario: Bash output repeats the identifier

- **WHEN** T6.3 runs
- **THEN** T6.3 SHALL repeat the command identifier in bash output events

### Requirement: Model changes report a result

T6.4 SHALL ALWAYS report the result of a model change.

#### Scenario: Model change reports its result

- **WHEN** T6.4 runs
- **THEN** T6.4 SHALL report the result of a model change

### Requirement: The command set is returned

T2.2 SHALL ALWAYS return the configured command set.

#### Scenario: The command set is returned

- **WHEN** T2.2 runs
- **THEN** T2.2 SHALL return the configured command set

### Requirement: The event diff is clean

T9.1 SHALL ALWAYS report no unexpected event names or fields.

#### Scenario: The event diff is clean

- **WHEN** T9.1 runs
- **THEN** T9.1 SHALL report no unexpected event names or fields

### Requirement: Acceptance terminates at quiescence

T9.2 SHALL ALWAYS terminate the stream at quiescence.

#### Scenario: Acceptance terminates at quiescence

- **WHEN** T9.2 runs
- **THEN** T9.2 SHALL terminate the stream at quiescence

### Requirement: The skill source precedes the command set

T2.1 SHALL complete BEFORE T2.2 SHALL run.

#### Scenario: The command set follows the skill source

- **WHEN** T2.1 completes
- **THEN** T2.2 SHALL run

### Requirement: Skill listing precedes skill expansion

T2.2 SHALL complete BEFORE T2.3 SHALL run.

#### Scenario: Skill expansion follows skill listing

- **WHEN** T2.2 completes
- **THEN** T2.3 SHALL run

### Requirement: Skill expansion precedes invocation suppression

T2.3 SHALL complete BEFORE T2.4 SHALL run.

#### Scenario: Invocation suppression follows skill expansion

- **WHEN** T2.3 completes
- **THEN** T2.4 SHALL run

### Requirement: The command set carries skills

T2.2 SHALL ALWAYS return each loaded skill as one `skill` command.

#### Scenario: A loaded skill appears in the command set

- **WHEN** T2.2 runs
- **THEN** T2.2 SHALL return each loaded skill as one `skill` command

### Requirement: The command set carries the pi shape

T2.2 SHALL ALWAYS return each command with the pi command shape.

#### Scenario: A command carries the pi shape

- **WHEN** T2.2 runs
- **THEN** T2.2 SHALL return each command with the pi command shape

### Requirement: Skill commands expand before the model call

T2.3 SHALL ALWAYS expand a `/skill:` message before the model call.

#### Scenario: A skill command expands before the model call

- **WHEN** T2.3 runs
- **THEN** T2.3 SHALL expand a `/skill:` message before the model call

### Requirement: Skill arguments reach the prompt

T2.3 SHALL ALWAYS append the skill command arguments to the expanded prompt.

#### Scenario: Skill arguments reach the prompt

- **WHEN** T2.3 runs
- **THEN** T2.3 SHALL append the skill command arguments to the expanded prompt

### Requirement: Instruction-only skills stay command-invocable

T2.4 SHALL ALWAYS keep a `disable-model-invocation` skill invocable by command.

#### Scenario: An instruction-only skill stays invocable

- **WHEN** T2.4 runs
- **THEN** T2.4 SHALL keep a `disable-model-invocation` skill invocable by command

### Requirement: Instruction-only skills leave the prompt listing

T2.4 SHALL ALWAYS omit a `disable-model-invocation` skill from the model selection listing.

#### Scenario: An instruction-only skill leaves the listing

- **WHEN** T2.4 runs
- **THEN** T2.4 SHALL omit a `disable-model-invocation` skill from the model selection listing

### Requirement: The command set carries extension commands

T2.2 SHALL ALWAYS return each registered extension command as one `extension` command.

#### Scenario: A registered command appears in the command set

- **WHEN** T2.2 runs
- **THEN** T2.2 SHALL return each registered extension command as one `extension` command

### Requirement: A command message is resolved before the model call

T3.10 SHALL ALWAYS resolve a `/name` message against the command registry before the model call.

#### Scenario: A command message is resolved before the model call

- **WHEN** T3.10 runs
- **THEN** T3.10 SHALL resolve a `/name` message against the command registry before the model call

### Requirement: A resolved command reports handled

T3.10 SHALL ALWAYS report `handled` for a resolved command.

#### Scenario: A resolved command reports handled

- **WHEN** T3.10 runs and the message matches a command
- **THEN** T3.10 SHALL report `handled` for the resolved command

### Requirement: A resolved command starts no model run

T3.10 SHALL NOT start a model run for a resolved command.

#### Scenario: A resolved command starts no run

- **WHEN** T3.10 runs and the message matches a command
- **THEN** T3.10 SHALL start no model run for the resolved command
