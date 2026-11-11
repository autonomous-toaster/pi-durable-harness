## Purpose

Let an extension ask the person driving the harness a question through pi's dialog sub-protocol, so an approval or an ask-the-user tool works over RPC instead of returning "no interactive client".

## Task Reference

| T ID | Description |
| --- | --- |
| T3.1 | Send a dialog request and correlate its response by id |
| T3.2 | Expose hasUI and route the dialog methods to the client |
| T3.3 | Settle every pending dialog on abort and on stdin close |
| T3.4 | Ignore a response whose id names no pending request |
| T4.2 | Exercise one answered dialog and one aborted dialog |
| T4.3 | Record the no-reconnect limitation in the README |

## ADDED Requirements

### Requirement: The transport precedes the dialog methods

T3.1 SHALL complete BEFORE T3.2 SHALL run.

#### Scenario: The methods follow the transport

- **WHEN** T3.1 completes
- **THEN** T3.2 SHALL run

### Requirement: A dialog request carries an identifier

T3.1 SHALL ALWAYS send one request per dialog call with an identifier unique to the connection.

#### Scenario: Each call sends one request

- **WHEN** T3.1 runs and an extension asks a question
- **THEN** T3.1 SHALL send one request carrying a unique identifier

#### Scenario: Only the four dialog methods are sent

- **WHEN** T3.1 runs and an extension asks a question
- **THEN** T3.1 SHALL name one of confirm, select, input, or editor

#### Scenario: Select options are strings

- **WHEN** T3.1 sends a select request
- **THEN** T3.1 SHALL send each option as a string

#### Scenario: The timeout is milliseconds

- **WHEN** T3.1 sends a request with a timeout
- **THEN** T3.1 SHALL carry the timeout in milliseconds

#### Scenario: Input sends no placeholder the client drops

- **WHEN** T3.1 sends an input request with a placeholder
- **THEN** T3.1 SHALL still resolve from the response value alone

### Requirement: A response resolves its request

T3.1 SHALL ALWAYS resolve the pending dialog that a response names.

#### Scenario: The answer reaches the extension

- **WHEN** T3.1 runs and a response names a pending request
- **THEN** T3.1 SHALL resolve that dialog with the response value

### Requirement: Extension UI calls reach the client

T3.2 SHALL ALWAYS report an attached client and route select, confirm, input, and editor to it.

#### Scenario: An extension sees an interactive client

- **WHEN** T3.2 runs and an extension inspects the UI availability
- **THEN** T3.2 SHALL report that a client is attached

#### Scenario: Without a client hasUI is false

- **WHEN** T3.2 runs and no client is attached
- **THEN** T5.3 SHALL report false

### Requirement: An abort settles a pending dialog

T3.3 SHALL ALWAYS settle every pending dialog unanswered when the run aborts or the input closes.

#### Scenario: An abort releases the dialog

- **WHEN** T3.3 runs and the run aborts with a dialog pending
- **THEN** T3.3 SHALL settle the dialog unanswered

### Requirement: An unknown response is ignored

T3.4 SHALL ALWAYS ignore a response whose identifier names no pending request.

#### Scenario: A stale response changes nothing

- **WHEN** T3.4 runs and a response names no pending request
- **THEN** T3.4 SHALL ignore the response and keep serving

### Requirement: The dialog test precedes the release

T4.2 SHALL ALWAYS exercise one answered dialog and one aborted dialog.

#### Scenario: Both dialog paths are covered

- **WHEN** T4.2 runs
- **THEN** T4.2 SHALL exercise an answered dialog and an aborted dialog

### Requirement: The reconnect limitation is documented

T4.3 SHALL ALWAYS record in the README that a pending dialog does not survive a reconnect.

#### Scenario: The limitation is stated

- **WHEN** T4.3 runs
- **THEN** T4.3 SHALL record the no-reconnect limitation in the README
