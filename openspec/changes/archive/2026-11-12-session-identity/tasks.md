## 1. Session identity (spec: `rpc-parity`)

- [x] 1.1 Resolve the session from an explicit id, or mint a new one, before storage opens. Verify a test covers a new session and a resumed one
- [x] 1.2 Open the newest session for the tenant and working directory on `-c`. Verify it picks the newer of two
- [x] 1.3 Refuse a session id that does not start and end with a letter or a digit. Verify a malformed id exits with a diagnostic
- [x] 1.4 Treat `-n/--name` as a display name. Verify two names with one id open the same session
- [x] 1.5 Report the resolved session id as `get_state.sessionId` across a restart. Verify the same id
- [x] 1.6 Read `--tenant`, defaulting to `default`, and scope the store by it. Verify one session id under two tenants opens two containers

## 2. Session store (spec: `session-store`)

- [x] 2.1 Place a SQLite session at `<sessionDir>/<cwd>/<tenant>__<session>.sqlite`. Verify two sessions in one directory create two files
- [x] 2.2 Open every PostgreSQL session with a per-session prefix in the one configured schema. Verify two sessions open two prefixes
- [x] 2.3 Upsert `(tenant, cwd, session, last_used)` in the catalog on open and at run end. Verify a second launch refreshes last use
- [x] 2.4 Derive SQLite `-c` recency from the session file's modification time. Verify the newest file wins

## 3. Storage backend (spec: `durable-storage-postgres`)

- [x] 3.1 Pass the session prefix to `SqliteStorage.open` in the configured schema. Verify the prefixed tables are created there
- [x] 3.2 Key the advisory lock by schema and prefix. Verify two prefixes open together and the same prefix twice is refused

## 4. Verification

- [x] 4.1 Run two sessions in one working directory at the same time. Verify each reports its own state
- [x] 4.2 Verify the README documents the session model, `-c`, `--session`, `--tenant`, and the storage layout
