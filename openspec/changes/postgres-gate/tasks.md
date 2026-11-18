## 1. The gate (spec: `durable-storage-postgres`)

- [x] 1.1 Add a CI workflow with a PostgreSQL 17 service, Node 22 and 24, and `npm run check` with the test URL set. Verify a failing conformance case fails the workflow
- [x] 1.2 Make the PostgreSQL suites fail instead of skip when the environment declares CI. Verify a CI environment without a URL fails and a local one skips

## 2. Driver discipline (spec: `durable-storage-postgres`)

- [x] 2.1 Parse `bigint` per query and drop the global parser mutation. Verify a test reads an identity as a number while a host pool's parser is untouched

## 2b. Connection hygiene (spec: `durable-storage-postgres`)

- [x] 2.2 Leave a released connection unscoped and destroy it, so the scope role and the ownership lock die with the storage. Verify the conformance fixture can drop its schema after close and a second writer is still refused

## 3. Snapshot reads (spec: `durable-storage-postgres`)

- [x] 3.1 Read a multi-statement document inside a repeatable-read snapshot. Verify a test commits between the two statements and observes one state

## 4. Dropped: identity encoding

The framework's conformance suite has no lone-surrogate case, and the SQLite reference cannot
round-trip one either: JSON-encoding indexed identities would be behaviour we invented. Dropped in
favour of upstream, which is the authority this change gates on.

## 5. Documentation (spec: `durable-storage-postgres`)

- [x] 5.1 Document how to run the gate locally and what it proves. Verify the README names the database variable and the conformance suite

## Found by turning the gate on, and resolved

The suite never ran, and running it found four things. Three are fixed above (the fixture opened
storage without a session prefix; `SET ROLE` leaked back into the host's pool; the ownership lock
survived on a pooled connection). The fourth is a **conflict between two requirements of
`durable-storage-postgres`**:

- `conversations_owner_task_fk` — our sixth deferred reference — rejects a conversation that names
  an `owner_task_id` no `tasks` row holds.
- The framework's conformance suite writes exactly that: it mints task ids and commits conversations
  owned by them without ever storing a task (`storage-conformance.js`, "filters and pages
  conversations by durable owner edges").

Resolved by removing the reference: upstream defines what a legal store is, so a constraint that
refuses a store upstream writes is behaviour we invented. Five references remain and all 33
conformance cases pass. The same rule removed the identity-encoding task above (upstream has no
lone-surrogate case, and its SQLite reference cannot round-trip one either).
