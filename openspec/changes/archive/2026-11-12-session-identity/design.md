## Context

See proposal.md - Why. Four facts from the code and from pi shape the approach.

**pi's model.** A session is a file under `~/.pi/agent/sessions/<cwd>/<uuid>.jsonl`. The *location* scopes the id; the id itself is a UUID. `-c` opens the most recent session for the current directory, `--session-id` opens or creates this directory's session with that id, `--session` takes a path or id, `-n/--name` is a display name, and a launch with none of these starts a new session.

**The harness today.** `key = --session-id ?? --session ?? -n/--name ?? basename(cwd)`, and that key *is* the storage identity: `identifier(key)` names a SQLite file or a PostgreSQL schema. `continueSession` is parsed and never read. `/a/proj` and `/b/proj` collide on `s_proj_e73c023a2e8e`.

**The runtime already models sessions as conversations.** `new_session`, `switch_session`, `fork`, and `clone` create and switch conversations inside one storage (`engine.newConversation()`, `engine.switchTo()`). Only startup pins one conversation per storage key.

**A chord store cannot help.** `StoreStorage` would put every session in one table set under an owner name, but `apply-batch.js` assigns `seq = lastSeq + 1` from an in-memory counter and writes `UPDATE meta SET last_seq = ?` with no compare-and-set, and `Claims` is an in-process map. One store therefore belongs to one process, which forbids two sessions in one directory.

## Goals / Non-Goals

**Goals:**

- Two sessions in one working directory, in two processes, in parallel.
- Several tenants in one PostgreSQL database without sharing a container.
- pi's startup semantics for `--session-id`, `--session`, `-c`, and `--name`.

**Non-Goals:**

- Per-tenant grants, roles, or row-level security. Nothing authenticates a caller, so structural isolation would protect nothing.
- `StoreStorage` for the reasons in Context.
- `-r/--resume` (an interactive picker) and `--fork` at startup; they are named in the design only to say they stay out.

## Decisions

**1. The container is the session.** A working directory cannot be the container because two sessions in it must write concurrently, and a storage admits one writer. One session, one container: a SQLite file or a PostgreSQL prefixed table set.

**2. The working directory is grouping, never identity.** It becomes a path component for SQLite and a catalog column for PostgreSQL. It does not enter the key, so `--session-id demo` under two directories is two sessions, matching pi, and no two directories can collide by name.

**3. The tenant is data.** It rides in the container name (`<tenant>__<session>.sqlite`, prefix `t_<h>__s_<h>__`) and in the catalog. A schema per tenant was considered and rejected: the process holds one connection as one role and would `SET search_path` to whichever tenant the argv names, so the isolation is the caller's choice. The catalog already carries the column, so per-tenant schemas or RLS become a migration when an identity layer exists.

**4. SQLite groups by directory and reads recency from the file.** `<sessionDir>/<cwd>/<tenant>__<session>.sqlite`. The directory answers "which sessions belong to this cwd" and the file's modification time answers "which was used last" — the same signal pi uses, with no bookkeeping and no extra file.

**5. PostgreSQL uses one schema, a prefix per session, and one catalog table.** `SqliteStorage.open(db, { prefix })` is upstream's mechanism; the advisory lock keys on schema plus prefix so two prefixes in one schema both open and the same prefix twice is refused. A backend with no directory needs somewhere to keep last use, so `harness.sessions(tenant, cwd, session, last_used)` is upserted on open and at run end. It is the only new state in the design, and a missed write makes `-c` stale rather than wrong.

**6. `-c` is a lookup, resolved per backend.** PostgreSQL reads the catalog. SQLite scans the directory for the tenant's files and takes the greatest modification time. Both answer pi's question — most recent for this directory — with the mechanism each backend actually has.

**7. Startup resolves the session before storage opens.** `--session-id`/`--session` open or create; `-c` looks up; nothing mints a UUID. The resolved id is what `get_state.sessionId` reports, so a resumed session keeps the id its client stored. Ids are validated against pi's rule (alphanumeric at both ends, letters, digits, `.`, `_`, `-`) and refused with a diagnostic rather than rewritten.

**8. `--name` stops being identity.** It sets a display name only, as in pi.

## Risks / Trade-offs

- **Prefix concentration.** Many table sets share one schema. Object count is unchanged from today (it moves from schema-per-session to prefix-per-session), but an unprefixed query would read another session's tables. → Durable generates every name from the prefix; the lock keeps one writer per prefix.
- **The catalog can lag.** It is written on open and at run end, so `-c` can point at the session used second-most-recently if a process died mid-run. → Accepted: pi's mtime has the same granularity, and the alternative is a write per commit.
- **No tenant enforcement.** A caller may name any tenant. → Documented; the column is ready for the day authentication exists.
- **SQLite directory scan.** `-c` stats every session file in the directory. → Bounded by the directory's session count and cheap; no index to maintain.

## Migration Plan

No compatibility shim, as agreed. Existing SQLite `<sessionDir>/s_*.sqlite` files and PostgreSQL `s_*` schemas are not read; a session started under the new layout is independent of them. Deploying is a rebuild.

## Open Questions

None blocking. The remaining unknown is when an identity layer lands, which would make per-tenant schemas or row-level security worth revisiting; that is a separate change.
