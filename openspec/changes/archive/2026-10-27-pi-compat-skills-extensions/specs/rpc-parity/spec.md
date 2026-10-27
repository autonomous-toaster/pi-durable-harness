# rpc-parity Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T2.1 | Read the loaded skills, templates, and commands |
| T2.2 | Map each listing entry to pi's command shape for get_commands |
| T2.3 | Expand a `/skill:<name> <args>` message before the model call |
| T2.4 | Keep a disable-model-invocation skill invocable by command |
| T3.10 | Resolve a `/name` message on the prompt command |

## MODIFIED Requirements

### Requirement: The command set is returned

T2.2 SHALL ALWAYS return the configured command set.

#### Scenario: The command set is returned

- **WHEN** T2.2 runs
- **THEN** T2.2 SHALL return the configured command set

## ADDED Requirements

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