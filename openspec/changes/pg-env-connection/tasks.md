## 1. Connection resolution (spec: `durable-storage-postgres`)

- [ ] 1.1 Resolve one connection field from `PI_DURABLE_<NAME>`, then `<NAME>`, then the URL, then a default, in one pure function. Verify a matrix test covers the four orders
- [ ] 1.2 Derive the prefixed name by adding `PI_DURABLE_` to the standard name. Verify a loop test covers `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`, `PGSSLROOTCERT`, `PGSSLCERT`, `PGSSLKEY`, `PGOPTIONS`, `PGAPPNAME`, and `PGCONNECT_TIMEOUT`
- [ ] 1.3 Resolve the session pool and the catalog pool from that one record. Verify a test asserts both pools receive the resolved host, user, and password
- [ ] 1.4 Accept `PGPASSWORD` while `PI_DURABLE_DATABASE_URL` names host, port, user, and database. Verify a test resolves the password from the environment and the rest from the URL

## 2. TLS names and modes (spec: `durable-storage-postgres`)

- [ ] 2.1 Read the mode from `PI_DURABLE_PGSSLMODE` and the certificates from `PI_DURABLE_PGSSLROOTCERT`, `PI_DURABLE_PGSSLCERT`, and `PI_DURABLE_PGSSLKEY`. Verify a test resolves a verifying decision from the new spellings
- [ ] 2.2 Reject `allow` and `prefer` with a diagnostic that names the accepted modes. Verify a test asserts both are refused
- [ ] 2.3 Reject `verify-ca` and `verify-full` without a root certificate path. Verify the diagnostic names `PI_DURABLE_PGSSLROOTCERT`
- [ ] 2.4 Delete `PI_DURABLE_PG_REQUIRE_SSL` and route its guarantee through the mode. Verify `rg PI_DURABLE_PG_REQUIRE_SSL` returns no hit in sources, help text, or README
- [ ] 2.5 Report an unencrypted connection as an error after the rename. Verify the encrypted-connection check still runs on a live connection

## 3. Backend selection (spec: `durable-storage-postgres`)

- [ ] 3.1 Select PostgreSQL from `PI_DURABLE_DATABASE_URL`, `PI_DURABLE_PGHOST`, or `PI_DURABLE_PG=1`. Verify a test opens a PostgreSQL configuration with no URL
- [ ] 3.2 Keep a standard name and a local flag from selecting PostgreSQL. Verify a test with `PGHOST` alone opens SQLite, and a test with `--no-session` beside a prefixed host stays local

## 4. Inherited options (spec: `durable-storage-postgres`)

- [ ] 4.1 Merge `PGOPTIONS` with the session's `-c app.session=<prefix>`, ours last. Verify a test asserts the inherited option comes first and the session option last

## 5. Documentation (spec: `durable-storage-postgres`)

- [ ] 5.1 Document the mapping table, the precedence ladder, and the four breaking renames in the README environment section, and update the `--help` list. Verify every prefixed name in the table appears in the code, and `--help` prints `PI_DURABLE_PGSSLMODE` and no `PI_DURABLE_PG_SSL`
