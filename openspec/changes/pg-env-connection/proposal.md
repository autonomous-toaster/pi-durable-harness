# Proposal

## Why

The PostgreSQL backend reads the server, the user, and the password from one URL. An
operator who keeps the password out of process arguments, as `psql` users do with
`PGPASSWORD`, has no supported way to do it. The driver happens to fall back to the
standard names today, but nothing states it, nothing tests it, and one of our own
options silently shadows the standard `PGOPTIONS`.

## What Changes

- Read the standard libpq connection names, each behind our prefix:
  `PI_DURABLE_PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`,
  `PGSSLROOTCERT`, `PGSSLCERT`, `PGSSLKEY`, `PGOPTIONS`, `PGAPPNAME`,
  `PGCONNECT_TIMEOUT`. The prefix carries the exact standard name, so the mapping is
  computed, not a table we maintain.
- The prefixed name wins over the bare name. The bare name stays readable as a
  fallback, so one shell serves `psql` and this harness.
- **BREAKING** — rename the TLS settings to the standard spellings:
  `PI_DURABLE_PG_SSL` → `PI_DURABLE_PGSSLMODE`, `PI_DURABLE_PG_SSL_CA` →
  `PI_DURABLE_PGSSLROOTCERT`, `PI_DURABLE_PG_SSL_CERT` → `PI_DURABLE_PGSSLCERT`,
  `PI_DURABLE_PG_SSL_KEY` → `PI_DURABLE_PGSSLKEY`.
- **BREAKING** — delete `PI_DURABLE_PG_REQUIRE_SSL`: `PI_DURABLE_PGSSLMODE=require`
  states the same intent, and the encrypted-connection check still runs.
- Refuse `allow` and `prefer`, which would need a plaintext fallback this backend does
  not have, and refuse `verify-ca`/`verify-full` without a root certificate.
- Merge `PGOPTIONS` with the session's `app.session` option, ours last, instead of
  replacing the inherited options.
- Let a prefixed host, or `PI_DURABLE_PG=1`, select PostgreSQL. A bare `PGHOST` MUST
  NOT select it, so a stray shell variable cannot move a session to another server.

## Capabilities

### New Capabilities

None. The connection settings belong to the backend that already owns them.

### Modified Capabilities

- `durable-storage-postgres`: how the backend resolves its connection settings, the
  precedence between prefixed and standard names, the accepted TLS modes, and which
  setting selects PostgreSQL.

## Impact

- `src/harness/config.ts`: reads the prefixed and standard names into one resolved
  connection record.
- `src/storage/postgres/ssl.ts`: the TLS decision reads the renamed names and rejects
  the unsupported modes.
- `src/harness/engine.ts` and `src/harness/session.ts`: both pools take the resolved
  record and the merged options.
- `README.md` and the `--help` environment list: the new names, the mapping, and the
  precedence ladder.
- Existing databases are untouched; the change is configuration only.
