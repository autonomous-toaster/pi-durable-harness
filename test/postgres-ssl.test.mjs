import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { poolOptions, resolveSsl, SslConfigError, sslModeFromUrl } from "../dist/storage/postgres/ssl.js";

const dir = mkdtempSync(join(tmpdir(), "pi-ssl-"));
const caPath = join(dir, "ca.pem");
writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
const url = "postgres://user@db.example.com:5432/harness";

test("no ssl request leaves the driver's own default", () => {
	assert.deepEqual(resolveSsl({ url, env: {} }), { mode: "disable", enforce: false });
});

test("sslmode in the URL is honoured, and the environment overrides it", () => {
	assert.equal(sslModeFromUrl(`${url}?sslmode=require`), "require");
	assert.equal(resolveSsl({ url: `${url}?sslmode=verify-full`, env: { PI_DURABLE_PG_SSL_CA: caPath } }).mode, "verify-full");
	assert.equal(resolveSsl({ url: `${url}?sslmode=verify-full`, env: { PI_DURABLE_PG_SSL: "require" } }).mode, "require");
});

test("a CA is read from disk and verification is what the mode promises", () => {
	const verified = resolveSsl({ url, env: { PI_DURABLE_PG_SSL: "verify-full", PI_DURABLE_PG_SSL_CA: caPath } });
	assert.equal(verified.enforce, true);
	assert.equal(verified.ssl.rejectUnauthorized, true);
	assert.match(verified.ssl.ca, /BEGIN CERTIFICATE/);

	const encryptedOnly = resolveSsl({ url, env: { PI_DURABLE_PG_SSL: "require" } });
	assert.equal(encryptedOnly.enforce, true);
	assert.equal(encryptedOnly.ssl.rejectUnauthorized, false);
});

test("a verification mode without a CA is refused rather than downgraded", () => {
	assert.throws(() => resolveSsl({ url, env: { PI_DURABLE_PG_SSL: "verify-ca" } }), SslConfigError);
});

test("enforcing TLS with SSL disabled is an error, not a silent clear-text run", () => {
	assert.throws(() => resolveSsl({ url, env: { PI_DURABLE_PG_REQUIRE_SSL: "1" } }), SslConfigError);
	assert.throws(
		() => resolveSsl({ url, env: { PI_DURABLE_PG_REQUIRE_SSL: "1", PI_DURABLE_PG_SSL: "disable" } }),
		SslConfigError,
	);
});

test("a client certificate needs its key, and a missing CA file is reported", () => {
	assert.throws(() => resolveSsl({ url, env: { PI_DURABLE_PG_SSL: "require", PI_DURABLE_PG_SSL_CERT: caPath } }), SslConfigError);
	assert.throws(
		() => resolveSsl({ url, env: { PI_DURABLE_PG_SSL: "verify-full", PI_DURABLE_PG_SSL_CA: join(dir, "missing.pem") } }),
		SslConfigError,
	);
});

test("poolOptions carries the verified TLS settings", () => {
	const env = { PI_DURABLE_PG_SSL: "verify-full", PI_DURABLE_PG_SSL_CA: caPath };
	const options = poolOptions(url, resolveSsl({ url, env }));
	assert.equal(options.connectionString, url);
	assert.equal(options.enforce, true);
	assert.equal(options.ssl.rejectUnauthorized, true);
});

test("a pooler gets the server name, so Supavisor can find the tenant", () => {
	const pooler = "postgres://postgres:pw@aws-0-region.pooler.example.com:6543/postgres";
	const env = { PI_DURABLE_PG_SSL: "verify-full", PI_DURABLE_PG_SSL_CA: caPath };
	const options = poolOptions(pooler, resolveSsl({ url: pooler, env }));
	assert.equal(options.ssl.servername, "aws-0-region.pooler.example.com");
	// An IP cannot be a TLS server name.
	const ipUrl = "postgres://postgres:pw@10.0.0.5:5432/postgres";
	const byIp = poolOptions(ipUrl, resolveSsl({ url: ipUrl, env }));
	assert.equal(byIp.ssl.servername, undefined);
});

test("ENOIDENTIFIER is explained rather than echoed", async () => {
	const { connectionHint } = await import("../dist/storage/postgres/ssl.js");
	const hint = connectionHint("postgres://postgres:pw@aws-0-region.pooler.example.com:6543/postgres", new Error("(ENOIDENTIFIER) no tenant identifier provided"));
	assert.match(hint, /postgres\.<project-ref>/);
	// Measured: the pooler ignores the server name for tenant resolution.
	assert.match(hint, /SERVERNAME does not help/);
	assert.equal(connectionHint(url, new Error("connection refused")), undefined);
});

test("a pooler URL without a tenant says so before connecting", async () => {
	const { missingTenant } = await import("../dist/storage/postgres/ssl.js");
	assert.match(
		missingTenant("postgres://postgres:pw@aws-0-region.pooler.example.com:6543/postgres"),
		/postgres\.<project-ref>/,
	);
	// A server name does not satisfy the pooler, so it must not silence the warning.
	assert.match(
		missingTenant("postgres://postgres:pw@aws-0-region.pooler.example.com:6543/postgres"),
		/not enough/,
	);
	// Already scoped, or not a pooler: nothing to say.
	assert.equal(missingTenant("postgres://postgres.abcdefgh:pw@aws-0-region.pooler.example.com:6543/postgres"), undefined);
	assert.equal(missingTenant("postgres://postgres:pw@db.example.com:5432/postgres"), undefined);
});
