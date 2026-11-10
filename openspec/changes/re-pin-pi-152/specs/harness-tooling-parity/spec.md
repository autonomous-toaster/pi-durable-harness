# harness-tooling-parity Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T1.1 | Pin every dependency to pi 1.5.2 |
| T1.2 | Declare pi-schema as a direct dependency |
| T1.3 | Capture the golden fixtures from pi 1.5.2 |
| T1.4 | Re-run the fixture diff |
| T2.1 | Build the built-in tool schemas with pi-schema |
| T2.2 | Build the MCP tool schemas with pi-schema |
| T2.3 | Apply pi-schema argument coercion |
| T2.4 | Compare the codemode description to the fixture |
| T7.3 | Record the one-way migration in the README |

## MODIFIED Requirements

### Requirement: The re-baselined diff is clean

T1.4 SHALL ALWAYS report no unexpected record name or field after the re-baseline.

#### Scenario: The re-baselined diff is clean

- **WHEN** T1.4 runs
- **THEN** T1.4 SHALL report no unexpected record name or field after the re-baseline

## ADDED Requirements

### Requirement: The pinned version matches pi 1.5.2

T1.1 SHALL ALWAYS pin each `@earendil-works/*` dependency to pi 1.5.2.

#### Scenario: The pin matches pi 1.5.2

- **WHEN** T1.1 runs
- **THEN** T1.1 SHALL pin each `@earendil-works/*` dependency to pi 1.5.2

### Requirement: Pi-schema is a direct dependency

T1.2 SHALL ALWAYS declare `@earendil-works/pi-schema` as a direct dependency.

#### Scenario: Pi-schema is declared directly

- **WHEN** T1.2 runs
- **THEN** T1.2 SHALL declare `@earendil-works/pi-schema` as a direct dependency

### Requirement: The fixtures come from pi 1.5.2

T1.3 SHALL ALWAYS capture the golden fixtures from pi 1.5.2.

#### Scenario: The fixtures come from pi 1.5.2

- **WHEN** T1.3 runs
- **THEN** T1.3 SHALL capture the golden fixtures from pi 1.5.2

### Requirement: Built-in schemas use pi-schema

T2.1 SHALL ALWAYS build each built-in tool parameter schema with pi-schema.

#### Scenario: A built-in schema comes from pi-schema

- **WHEN** T2.1 runs
- **THEN** T2.1 SHALL build each built-in tool parameter schema with pi-schema

### Requirement: MCP schemas use pi-schema

T2.2 SHALL ALWAYS build each MCP tool parameter schema with pi-schema.

#### Scenario: An MCP schema comes from pi-schema

- **WHEN** T2.2 runs
- **THEN** T2.2 SHALL build each MCP tool parameter schema with pi-schema

### Requirement: Argument coercion matches pi

T2.3 SHALL ALWAYS apply pi-schema coercion to each tool argument value.

#### Scenario: A numeric string becomes a number

- **WHEN** T2.3 runs and the model sends a numeric string
- **THEN** T2.3 SHALL coerce the string to a number

### Requirement: The codemode description is unchanged

T2.4 SHALL ALWAYS match the captured codemode description.

#### Scenario: The codemode description matches the fixture

- **WHEN** T2.4 runs
- **THEN** T2.4 SHALL match the captured codemode description

### Requirement: The migration is documented

T7.3 SHALL ALWAYS record the one-way migration and the absent rollback in the README.

#### Scenario: The README records the migration

- **WHEN** T7.3 runs
- **THEN** T7.3 SHALL record the one-way migration and the absent rollback in the README

## REMOVED Requirements

### Requirement: The pinned version matches pi

T1.1 SHALL ALWAYS pin each dependency to one pinned pi release.

**Reason**: The pin moves from pi 1.4.0 to pi 1.5.2.

**Migration**: Use "The pinned version matches pi 1.5.2".

### Requirement: The fixtures match the pinned version

T1.3 SHALL ALWAYS capture the golden fixtures from one pinned pi release.

**Reason**: The golden fixtures move from pi 1.4.0 to pi 1.5.2.

**Migration**: Use "The fixtures come from pi 1.5.2".
