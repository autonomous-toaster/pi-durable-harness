## Purpose

Reports non-fatal harness faults on stderr so a client can see an unsupported capability without a broken run or a corrupted response stream.

## Task Reference

| T ID | Description |
| --- | --- |
| T3.5 | Classify each extension capability as hosted or unsupported |
| T3.6 | Report an unsupported surface on stderr |

## ADDED Requirements

### Requirement: Classification precedes the diagnostic

T3.5 SHALL complete BEFORE T3.6 SHALL run.

#### Scenario: The diagnostic follows classification

- **WHEN** T3.5 completes
- **THEN** T3.6 SHALL run

### Requirement: Diagnostics stay on stderr

T3.6 SHALL ALWAYS write each diagnostic only to stderr.

#### Scenario: A diagnostic avoids stdout

- **WHEN** T3.6 runs
- **THEN** T3.6 SHALL write each diagnostic only to stderr

### Requirement: Diagnostics name the cause

T3.6 SHALL ALWAYS name the extension and the surface in each diagnostic.

#### Scenario: A diagnostic names the extension and the surface

- **WHEN** T3.6 runs
- **THEN** T3.6 SHALL name the extension and the surface in each diagnostic

### Requirement: Diagnostics do not end the run

T3.6 SHALL ALWAYS keep the run alive after a diagnostic.

#### Scenario: The run survives a diagnostic

- **WHEN** T3.6 runs
- **THEN** T3.6 SHALL keep the run alive after a diagnostic

### Requirement: A diagnostic never replaces a call with a no-op

T3.6 SHALL NOT silently discard an unsupported surface call.

#### Scenario: An unsupported call is not silently discarded

- **WHEN** T3.6 runs for an unsupported surface
- **THEN** T3.6 SHALL write a diagnostic instead of silently discarding the call