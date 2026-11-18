# Proposal

## Why

The PostgreSQL backend has the framework's own storage conformance suite in the tree
(`test/postgres-storage.test.mjs`) and a parity test against `MemoryStorage`, but both skip unless
`TEST_DATABASE_URL` is set, and the repository has no CI — so nothing has ever run the PostgreSQL
path before a commit. That is not hypothetical: a process-fatal bug (a lost pooled client throwing
out of the process) shipped and was found only by running the cluster by hand.

An independent PostgreSQL backend for the same framework (`j-koester/pi-durable-postgres`) makes the
gap plain: it runs `registerStorageConformance` in CI against a `postgres:17` service, and its
facade avoids three things ours does not — global driver mutations, `READ COMMITTED` reads across
multiple statements, and lossy identity text.

## What Changes

- **CI exists**: Node 22 and 24, a PostgreSQL 17 service, `npm ci`, and `npm run check` with
  `TEST_DATABASE_URL` set so the conformance and parity suites actually run.
- **The conformance suite is part of the gate**, not an optional extra: it fails in CI when the URL
  is missing, and still skips on a developer machine without a database.
- **No global driver mutation**: `bigint` is parsed per query (`types`), instead of
  `pg.types.setTypeParser(20, …)` changing the parser for every `pg` consumer in the process.
- **Multi-statement document reads observe one committed state**: a `REPEATABLE READ` snapshot for
  the read paths that issue more than one statement, where `READ COMMITTED` can straddle a commit.
- **Identities round-trip losslessly**: indexed identity columns (`kind`, `key_value`,
  `request_id`) store JSON-encoded text, so an id containing a lone UTF-16 surrogate survives.

## Capabilities

### New Capabilities

None. The assurance and the two correctness properties belong to the backend that owns them.

### Modified Capabilities

- `durable-storage-postgres`: the backend is verified by the framework's conformance suite in the
  gate, does not mutate the driver's global parsers, reads a document from one snapshot, and stores
  identities losslessly.

## Impact

- `.github/workflows/ci.yml`: new — the gate, with a PostgreSQL service.
- `scripts/check.mjs` and `package.json`: a way to run the gate with a database, and to fail rather
  than skip when the environment says this is CI.
- `src/storage/postgres/database.ts`: per-query type parsing, a snapshot transaction, and the read
  paths that use it.
- `src/storage/postgres/ddl.ts` and `layout.ts`: identity columns as JSON-encoded text.
- `test/`: the conformance and parity suites become gating rather than optional.
- `README.md`: how to run the gate locally, and what the gate proves.
