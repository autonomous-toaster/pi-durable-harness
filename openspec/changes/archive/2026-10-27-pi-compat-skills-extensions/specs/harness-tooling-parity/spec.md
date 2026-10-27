# harness-tooling-parity Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T1.1 | Pin every `@earendil-works/*` dependency to 1.4.0 |
| T1.3 | Re-capture the golden fixtures from pi 1.4.0 |
| T1.4 | Re-run the fixture diff against the re-baselined corpus |
| T3.2 | Translate registerTool to durable tools |
| T3.5 | Classify each extension capability as hosted or unsupported |
| T3.8 | Forward registerProvider to the model runtime |
| T8.2 | Align skills and instructions loading (archived change) |

## MODIFIED Requirements

### Requirement: Skills match pi

T8.2 SHALL ALWAYS make the same skills and instructions available as pi.

#### Scenario: Skills match pi

- **WHEN** T8.2 runs
- **THEN** T8.2 SHALL make the same skills and instructions available as pi

## ADDED Requirements

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