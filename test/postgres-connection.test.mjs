import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	STANDARD_NAMES,
	connectionOptions,
	prefixedName,
	resolveConnection,
	resolveField,
	selectsPostgres,
} from "../dist/storage/postgres/connection.js";
import { resolveConfig } from "../dist/harness/config.js";

const url = "postgres://alice:url-pw@db.example.com:5433/app?sslmode=require";
/** The shape an operator uses when the password lives in the environment. */
const urlWithoutPassword = "postgres://alice@db.example.com:5433/app";

test("one field comes from the prefixed name, then the URL, then the standard name", () => {
	// All four sources present: the prefixed one wins.
	assert.equal(
		resolveField("PGHOST", { env: { PI_DURABLE_PGHOST: "prefixed", PGHOST: "standard" }, urlValue: "url-host", fallback: "default" }),
		"prefixed",
	);
	// No prefixed value: the URL wins over the standard name, as the driver does.
	assert.equal(resolveField("PGHOST", { env: { PGHOST: "standard" }, urlValue: "url-host" }), "url-host");
	// No prefixed value and no URL part: the standard name serves.
	assert.equal(resolveField("PGHOST", { env: { PGHOST: "standard" }, fallback: "default" }), "standard");
	// Nothing declared: the default serves.
	assert.equal(resolveField("PGHOST", { env: {}, fallback: "default" }), "default");
});

test("the prefixed name is the standard name behind PI_DURABLE_", () => {
	assert.equal(prefixedName("PGHOST"), "PI_DURABLE_PGHOST");
	assert.equal(STANDARD_NAMES.length, 12);
	// The prefixed name wins for every supported field, without a per-field table.
	for (const name of STANDARD_NAMES) {
		assert.equal(resolveField(name, { env: { [prefixedName(name)]: "declared" }, urlValue: "url-value" }), "declared", name);
	}
});

test("every prefixed name reaches its field", () => {
	const dir = mkdtempSync(join(tmpdir(), "pg-conn-names-"));
	const pem = join(dir, "cert.pem");
	writeFileSync(pem, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
	const connection = resolveConnection({
		url: undefined,
		env: {
			PI_DURABLE_PGHOST: "db.example.com",
			PI_DURABLE_PGPORT: "6543",
			PI_DURABLE_PGUSER: "alice",
			PI_DURABLE_PGPASSWORD: "secret",
			PI_DURABLE_PGDATABASE: "appdb",
			PI_DURABLE_PGSSLMODE: "require",
			PI_DURABLE_PGSSLROOTCERT: pem,
			PI_DURABLE_PGSSLCERT: pem,
			PI_DURABLE_PGSSLKEY: pem,
			PI_DURABLE_PGOPTIONS: "-c statement_timeout=5000",
			PI_DURABLE_PGAPPNAME: "pi-durable",
			PI_DURABLE_PGCONNECT_TIMEOUT: "7",
		},
	});
	assert.equal(connection.host, "db.example.com");
	assert.equal(connection.port, 6543);
	assert.equal(connection.user, "alice");
	assert.equal(connection.password, "secret");
	assert.equal(connection.database, "appdb");
	assert.equal(connection.options, "-c statement_timeout=5000");
	assert.equal(connection.applicationName, "pi-durable");
	assert.equal(connection.connectTimeoutMs, 7000);
	assert.equal(connection.ssl.mode, "require");
	assert.match(connection.ssl.ssl.cert, /BEGIN CERTIFICATE/);
	assert.match(connection.ssl.ssl.key, /BEGIN CERTIFICATE/);
});

test("the password may live outside the URL", () => {
	const connection = resolveConnection({ url: urlWithoutPassword, env: { PGPASSWORD: "from-env" } });
	assert.equal(connection.host, "db.example.com");
	assert.equal(connection.port, 5433);
	assert.equal(connection.user, "alice");
	assert.equal(connection.database, "app");
	assert.equal(connection.password, "from-env");
});

test("a password in the URL still wins over the standard name", () => {
	assert.equal(resolveConnection({ url, env: { PGPASSWORD: "from-env" } }).password, "url-pw");
	assert.equal(
		resolveConnection({ url, env: { PGPASSWORD: "from-env", PI_DURABLE_PGPASSWORD: "declared" } }).password,
		"declared",
	);
});

test("the TLS decision reads the standard spellings behind the prefix", () => {
	const dir = mkdtempSync(join(tmpdir(), "pg-conn-"));
	const root = join(dir, "root.pem");
	writeFileSync(root, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
	const env = { PI_DURABLE_PGSSLMODE: "verify-full", PI_DURABLE_PGSSLROOTCERT: root };
	const decision = resolveConnection({ url: undefined, env }).ssl;
	assert.equal(decision.mode, "verify-full");
	assert.equal(decision.enforce, true);
	assert.equal(decision.ssl.rejectUnauthorized, true);
	assert.match(decision.ssl.ca, /BEGIN CERTIFICATE/);
});

test("the two modes with a plaintext fallback are refused", () => {
	for (const mode of ["allow", "prefer"]) {
		assert.throws(
			() => resolveConnection({ url: undefined, env: { PI_DURABLE_PGSSLMODE: mode } }),
			/plaintext fallback/,
			mode,
		);
	}
});

test("a verifying mode names the root certificate setting", () => {
	assert.throws(
		() => resolveConnection({ url: undefined, env: { PI_DURABLE_PGSSLMODE: "verify-ca" } }),
		/ PI_DURABLE_PGSSLROOTCERT/,
	);
});

test("only a prefixed setting selects PostgreSQL", () => {
	assert.equal(selectsPostgres({ PGHOST: "standard" }), false);
	assert.equal(selectsPostgres({ PI_DURABLE_PGHOST: "declared" }), true);
	assert.equal(selectsPostgres({ PI_DURABLE_PG: "1" }), true);
	assert.equal(selectsPostgres({ PI_DURABLE_DATABASE_URL: url }), true);
});

test("a prefixed host selects PostgreSQL, and a bare one does not", () => {
	assert.equal(resolveConfig([], { PI_DURABLE_PGHOST: "db.example.com" }, "/w").pg?.host, "db.example.com");
	assert.equal(resolveConfig([], { PGHOST: "db.example.com" }, "/w").pg, undefined);
});

test("a local flag keeps the session local", () => {
	const env = { PI_DURABLE_PGHOST: "db.example.com" };
	assert.equal(resolveConfig([], env, "/w").pg?.host, "db.example.com");
	assert.equal(resolveConfig(["--no-session"], env, "/w").pg, undefined);
	assert.equal(resolveConfig(["--session-dir", "/tmp/s"], env, "/w").pg, undefined);
});

test("the session option follows the inherited options", () => {
	const connection = resolveConnection({ url: undefined, env: { PI_DURABLE_PGOPTIONS: "-c statement_timeout=5000" } });
	const options = connectionOptions(connection, "-c app.session=s_1a2b_");
	assert.equal(options.options, "-c statement_timeout=5000 -c app.session=s_1a2b_");
	// The catalog pool carries the inherited options and no session scope.
	assert.equal(connectionOptions(connection).options, "-c statement_timeout=5000");
});

test("both pools are built from the one resolved record", async () => {
	const { readFileSync } = await import("node:fs");
	const engine = readFileSync(new URL("../src/harness/engine.ts", import.meta.url), "utf8");
	const session = readFileSync(new URL("../src/harness/session.ts", import.meta.url), "utf8");
	// Neither pool builds itself from the URL any more; both use the record.
	assert.match(engine, /connectionOptions\(config\.pg/);
	assert.match(session, /connectionOptions\(config\.pg\)/);
	assert.doesNotMatch(session, /connectionString: config\./);
});
