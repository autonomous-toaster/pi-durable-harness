# Design

## Context

See `proposal.md` - Why. Three facts about the current code shape the approach.

`src/storage/postgres/ssl.ts` already resolves a TLS decision from the environment and
returns `{ mode, ssl, enforce }`; `src/harness/config.ts` stores that decision in
`config.pgSsl`, so a bad certificate setup fails at startup rather than at the first
query. The connection itself is the URL: `poolOptions(url, decision)` returns a
connection string and an optional `ssl` object, and both pools — the session pool in
`engine.ts` and the short-lived catalog pool in `session.ts` — build themselves from
that pair.

The driver resolves what we do not pass. `pg`'s `ConnectionParameters` reads
`process.env['PG' + NAME]` for every field before falling back to its defaults, and a
URL part beats both. That is why `PGPASSWORD` already works when the URL omits the
password, and why the current behaviour is undocumented rather than absent.

## Goals / Non-Goals

**Goals**

- One resolution function, pure, that answers every connection field from a prefixed
  name, a standard name, a URL, and a default, in that order.
- A test that loops over the supported standard names, so a field added later cannot be
  forgotten.
- Failures at startup, not at the first query.

**Non-Goals**

- `.pgpass` and `PGPASSFILE`. A password file is a format with wildcards, quoting, and
  a permission check; one environment variable covers the stated need.
- `PGSERVICE` / `PGSERVICEFILE`. A service file is a second configuration layer, not a
  connection field.
- Reading `PG*` for tuning that we do not act on (`PGREPLICATION`, `PGCLIENTENCODING`).

## Decisions

### The prefix carries the exact standard name

`PI_DURABLE_` + `PGPASSWORD` gives `PI_DURABLE_PGPASSWORD`. A resolution function
computes the prefixed name from the standard one, so the mapping cannot drift, and a
test enumerates the standard names.

*Alternative considered:* `PI_DURABLE_PG_PASSWORD` for consistency with the shipped
`PI_DURABLE_PG_SCHEMA`. Rejected because every name then needs a hand-written entry in
two places (code and documentation), and because the mechanical form lets an operator
translate a working `psql` environment by adding one prefix.

### Names libpq does not have keep a visibly different shape

`PI_DURABLE_PG_SCHEMA` and `PI_DURABLE_PG_SSL_SERVERNAME` stay as they are. libpq has
no `PGSCHEMA` and no server name variable; the second comes from the host. A name such
as `PI_DURABLE_PGSCHEMA` would look standard to a reader and would not exist in
`psql`. The underscore marks a setting that is ours.

### The URL keeps its name

`PI_DURABLE_DATABASE_URL` is the backend selector, not a connection field, and libpq
has no URL variable at all. It stays, and the README states the distinction in one
line.

*Alternative considered:* rename it to `PI_DURABLE_PGURL` and alias the old name.
Rejected: it invites a decade of "which one wins" for no behavioural gain.

### Precedence: prefixed, then URL, then standard, then default

The URL's parts beat the standard names, because the driver already behaves that way
and because a URL is a deliberate, complete statement. The prefixed names beat the URL
so that a declared value cannot be overridden by an inherited one.

### Only a prefixed setting selects the backend

A bare `PGHOST` is ambient: it may have been exported for `psql` months ago. A
prefixed name exists only because someone typed it. So `PI_DURABLE_PGHOST` (or
`PI_DURABLE_PG=1`) may switch the backend to PostgreSQL, and `PGHOST` may not.

*Alternative considered:* treat any complete standard environment as a connection.
Rejected: it turns a stray shell variable into a write against another server.

### The TLS mode keeps libpq's name and refuses two of libpq's values

`PI_DURABLE_PGSSLMODE` accepts `disable`, `require`, `verify-ca`, and `verify-full`.
`allow` and `prefer` are refused, because both describe a plaintext fallback this
backend does not implement, and a silent downgrade is the one outcome the setting
exists to prevent. A verifying mode without `PI_DURABLE_PGSSLROOTCERT` is refused for
the same reason.

### Inherited options are merged, and the session option comes last

The session pool passes `-c app.session=<prefix>` to scope the row-level-security
policy. `PGOPTIONS` now contributes to the same string, and our clause is appended
last, so a caller cannot replace the scope that the isolation policy reads. The scope
is defence in depth rather than a boundary — the credentials can read every table
directly — but a last-position clause costs nothing.

## Risks / Trade-offs

- **A renamed variable is silently ignored** (`PI_DURABLE_PG_SSL`), and the connection
  then falls back to the bare name or to no TLS. → The startup check already refuses
  an unencrypted connection once a mode is set; the README states the new spelling, and
  the release notes mark the rename as breaking.
- **`PI_DURABLE_PGSSLMODE=verify-full` without a root certificate** now fails at
  startup, where the old `PI_DURABLE_PG_SSL=verify-full` also failed. Operators
  migrating a working setup will see the failure and add the certificate path.
- **A prefixed host selects PostgreSQL** with no URL, so a typo in
  `PI_DURABLE_PGHOST` opens a session against an unreachable server rather than
  falling back to SQLite. → The failure is a connection error naming the host, which is
  the honest outcome for a declared destination.
- **`PGOPTIONS` may carry a clause we do not understand** (an unknown `-c` setting).
  The server rejects it and the error names the setting; we do not parse or filter it.

## Migration Plan

1. Rename the four TLS settings and add the connection names in one commit, with the
   README and the `--help` list updated in the same commit.
2. Deploy. A deployment that set only `PI_DURABLE_DATABASE_URL` continues unchanged,
   because that name is untouched and the URL still beats the standard names.
3. Rollback: restore the previous binary. The environment needs the old spellings;
   both binaries read the same URL.

## Open Questions

None. The two questions that remained during exploration — dropping the old spellings
outright, and folding the encrypted-connection requirement into the TLS mode — are
answered in the proposal as breaking changes, in line with the project's rule that it
carries no backward compatibility.
