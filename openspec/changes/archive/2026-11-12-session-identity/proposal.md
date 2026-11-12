## Why

Session initialization does not match pi, and in two places it is actively wrong.

The storage identity is the session key, and the key defaults to `basename(cwd)`. Two projects named `proj` therefore share one session — measured: `/a/proj` and `/b/proj` both resolve to `s_proj_e73c023a2e8e` — while `README.md:154` promises the opposite. `-c/--continue` is parsed into `HarnessConfig.continueSession` and never read, so a documented flag does nothing. `-n/--name` is identity here and a display name in pi. `--session` and `--session-id` collapse to one field, so a path is silently lowercased and underscored into an id. And because the key is the storage, every launch without `--session-id` reopens the previous conversation: the harness always continues, where pi always starts a new session.

The storage layer carries the same artefact: one PostgreSQL schema per session, with nine tables, six indexes, and one advisory lock each.

Two requirements drive the correction. A person must be able to run **two sessions in one directory at the same time**. And several **tenants must share one PostgreSQL database**.

## What Changes

- **BREAKING** for the session model: the container is the session, and a launch with no session flag starts a **new** session with a fresh UUID, as pi does. The working directory is grouping, never identity.
- `--session-id <uuid>` and `--session <uuid>` open that session in this directory, or create it. pi's id rule is enforced and a non-conforming value is refused with a diagnostic instead of being rewritten.
- `-c/--continue` opens the newest session for the current tenant and working directory, matching pi's "most recent session for the current directory".
- `-n/--name` becomes a display name only.
- `--tenant <name>` (default `default`) labels the session. The tenant is data, not structure: it rides in the container name and the catalog, and no schema or table is created per tenant.
- SQLite sessions move to `<sessionDir>/<cwd>/<tenant>__<session>.sqlite`, so a directory groups its sessions and the file's modification time answers `-c` with no bookkeeping.
- **BREAKING** for PostgreSQL storage: every session shares **one schema** and opens with a per-session table prefix; the advisory lock keys on schema and prefix. A catalog table records `(tenant, cwd, session, last_used)` so `-c` has an answer in a backend with no directory to hang mtime on.
- The README's session and storage sections are rewritten; three current claims are false.

## Capabilities

### New Capabilities

- `session-store`: where a session's storage lives for each backend, how the tenant and working directory scope it, the PostgreSQL catalog, and how the newest session is found.

### Modified Capabilities

- `rpc-parity`: startup resolves the session from the pi flags, including continue, name-as-display, and the tenant.
- `durable-storage-postgres`: the facade opens a prefixed storage in one schema and keys its advisory lock on schema and prefix.

## Impact

- **Code**: `src/harness/config.ts` (`--tenant`, `-c` wiring, id validation, `--name` semantics), `src/index.ts` (session resolution before storage opens), `src/harness/engine.ts` (`openStorage` path and prefix, `get_state` identity), `src/storage/postgres/{storage,database}.ts` (one schema, prefix, lock key), `src/harness/engine.ts` catalog write on open and at run end, plus the SQLite layout.
- **Dependencies**: none new. No `StoreStorage`: a chord store assigns its sequence from an in-memory counter and writes it without a compare-and-set, so one store belongs to one process, which forbids two sessions in one directory.
- **Verification**: a startup test with two concurrent sessions in one directory, a `-c` test that picks the newest and not the oldest, an id-validation test, a tenant-isolation test, and the existing PostgreSQL conformance suite re-run against a prefixed storage.
- **Risk**: the catalog is the only new state; a missed write makes `-c` stale rather than wrong, and it upserts on open and at run end.
- **Risk**: prefix-per-session concentrates many table sets in one schema. Object count is unchanged from today (it moves from schema-per-session to prefix-per-session), but the namespace is shared, so a stray unprefixed query would read the wrong session.
- **Not addressed**: no authentication exists, so the tenant is a label. Per-tenant grants, roles, and row-level security are out of scope until a caller can be authenticated; the catalog already carries the tenant for that day.
