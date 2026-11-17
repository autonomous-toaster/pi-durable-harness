## Task Reference

| T ID | Description |
| --- | --- |
| T1.1 | Accept a framework report and classify it |
| T1.2 | Report a faulted task where the user is looking |
| T2.1 | Reopen the session after a storage failure |
| T2.2 | Refuse a prompt with a typed answer while the session recovers |
| T2.3 | Keep the session identity and the transcript across a reopen |
| T3.1 | Close the session on a termination signal |
| T3.2 | Verify a held commit is stored before the process exits |
| T4.1 | Report the reason a run ended |
| T4.2 | Answer a non-zero exit status for a run that did not answer |
| T2.4 | Wait between reopen attempts that fail |
| T2.5 | Bound the close that precedes a reopen |
| T2.6 | Refuse a reopen for an in-memory session |
| T2.7 | Name a lock refusal during a reopen |
| T3.3 | Verify a reopen on PostgreSQL |
| T6.1 | Document the failure vocabulary and the reopen behaviour |

## ADDED Requirements

### Requirement: A storage failure is classified before it is acted on

T1.1 SHALL classify a report BEFORE T2.1 SHALL reopen a failed session.

#### Scenario: The storage fails mid-session

- **WHEN** T1.1 reads a report whose kind names a failed session
- **THEN** T1.1 SHALL name the failure as a failed session and SHALL hand the session to a reopen

#### Scenario: A task faults

- **WHEN** T1.1 reads a report whose kind names a faulted task
- **THEN** T1.1 SHALL name the task and the reason instead of treating the session as failed

### Requirement: A faulted task reaches the user

T1.2 SHALL report a faulted task AFTER T1.1 SHALL classify the report.

#### Scenario: A run faults on the restart limit

- **WHEN** T1.2 reads a faulted task whose reason names the restart limit
- **THEN** T1.2 SHALL report that reason where the user is looking, and SHALL NOT report a failed session

### Requirement: A failed session is reopened

T2.1 SHALL reopen the session AFTER T1.1 SHALL classify a storage failure.

#### Scenario: PostgreSQL restarts under a running session

- **WHEN** T2.1 reopens after a classified storage failure
- **THEN** T2.1 SHALL open the same session storage again, resume it, and continue the session

#### Scenario: The reopen itself fails

- **WHEN** T2.1 cannot open the storage again
- **THEN** T2.1 SHALL report the failure, wait before the next attempt, and SHALL NOT answer a prompt as if the session were healthy

### Requirement: A recovering session refuses work explicitly

T2.2 SHALL answer a prompt with a typed refusal AFTER T2.1 SHALL start a reopen.

#### Scenario: A prompt arrives during a reopen

- **WHEN** T2.2 reads a prompt while a reopen is in flight
- **THEN** T2.2 SHALL answer a refusal that names the recovery, and SHALL NOT accept the prompt

### Requirement: A reopen keeps the session

T2.3 SHALL read the transcript AFTER T2.1 SHALL reopen the session.

#### Scenario: The transcript after a reopen

- **WHEN** T2.3 reads the transcript of a reopened session
- **THEN** T2.3 SHALL find every entry committed before the failure and the same session identity

### Requirement: A close that hangs does not stall the reopen

T2.5 SHALL bound the close BEFORE T2.1 SHALL reopen the session.

#### Scenario: The server vanished with clients checked out

- **WHEN** T2.5 closes against a server that no longer answers
- **THEN** T2.5 SHALL stop waiting at the bound and let the reopen start

### Requirement: An in-memory session is not reopened

T2.6 SHALL refuse a reopen for an in-memory session BEFORE T2.1 SHALL open a second storage.

#### Scenario: A storage failure without a store

- **WHEN** T2.6 reads a failure on a session that keeps nothing
- **THEN** T2.6 SHALL report that the session cannot be reopened and SHALL NOT open a second store

### Requirement: A lock refusal during a reopen names its cause

T2.7 SHALL name a lock refusal AFTER T1.1 SHALL classify a storage failure.

#### Scenario: The previous connection has not been released

- **WHEN** T2.7 reads a lock refusal while reopening
- **THEN** T2.7 SHALL report that the previous connection is being waited for, and SHALL NOT name another process

### Requirement: A reopen is verified on PostgreSQL

T3.3 SHALL verify a reopen on PostgreSQL AFTER T2.1 SHALL reopen the session.

#### Scenario: The cluster dies under a running session

- **WHEN** T3.3 stops the PostgreSQL cluster under a running session and starts the cluster again
- **THEN** T3.3 SHALL find the process alive, the reopen reported, and every entry committed before the failure still present

### Requirement: A reopen that fails waits before the next attempt

T2.4 SHALL wait between attempts BEFORE T2.1 SHALL try a reopen again.

#### Scenario: The server is still down

- **WHEN** T2.4 reads a reopen that failed
- **THEN** T2.4 SHALL report the failure and wait before the session tries again

### Requirement: A termination signal closes the session

T3.1 SHALL close the session AFTER T3.1 SHALL read a termination signal.

#### Scenario: The operator sends an interrupt

- **WHEN** T3.1 reads an interrupt or a termination request
- **THEN** T3.1 SHALL close the session before the process exits, bounded by a timeout

### Requirement: Held work is stored before the exit

T3.2 SHALL verify a held commit is stored AFTER T3.1 SHALL close on a signal.

#### Scenario: A signal during a streamed answer

- **WHEN** T3.2 measures a close that follows a signal mid-stream
- **THEN** T3.2 SHALL find the deferred commit stored and no invocation left running

### Requirement: A run reports why it ended

T4.1 SHALL report the reason a run ended BEFORE T4.2 SHALL answer an exit status.

#### Scenario: A run ends without an answer

- **WHEN** T4.1 reads a run that ended unanswered for a named reason
- **THEN** T4.1 SHALL report that reason and the advice the framework gives for that reason

#### Scenario: A run answers

- **WHEN** T4.1 reads a run that ended with an answer
- **THEN** T4.1 SHALL report no failure reason

### Requirement: The documentation states the host behaviour

T6.1 SHALL document the failure vocabulary AFTER T4.1 SHALL report a reason a run ended.

#### Scenario: An operator reads what a signal costs

- **WHEN** T6.1 documents the host behaviour
- **THEN** T6.1 SHALL state the reopen, the reason vocabulary, and the tail a hard kill can lose

### Requirement: A run that did not answer fails the command

T4.2 SHALL answer a non-zero exit status AFTER T4.1 SHALL report a faulted run.

#### Scenario: A one-shot run faults

- **WHEN** T4.2 answers the exit status of a run whose reason is a fault
- **THEN** T4.2 SHALL answer a non-zero status
