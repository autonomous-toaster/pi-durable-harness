# failure-diagnostics Delta

## Task Reference

| T ID | Description |
| --- | --- |
| T9.5 | Contain a throwing handler to a diagnostic |
| T11.2 | Accept an inert surface without a diagnostic |
| T11.3 | Report an unapplied handler result |

## ADDED Requirements

### Requirement: A handler throw is reported

T9.5 SHALL ALWAYS name the extension and the event in a handler-throw diagnostic.

#### Scenario: A throw diagnostic names the extension and event

- **WHEN** T9.5 runs
- **THEN** T9.5 SHALL name the extension and the event in a handler-throw diagnostic

### Requirement: An inert surface stays silent

T11.2 SHALL NOT write a diagnostic for an inert surface.

#### Scenario: An inert surface writes nothing

- **WHEN** T11.2 runs
- **THEN** T11.2 SHALL NOT write a diagnostic for an inert surface

### Requirement: An unapplied result names its field

T11.3 SHALL ALWAYS name the extension, the event, and the field in an unapplied-result diagnostic.

#### Scenario: An unapplied result names its field

- **WHEN** T11.3 runs
- **THEN** T11.3 SHALL name the extension, the event, and the field in an unapplied-result diagnostic
