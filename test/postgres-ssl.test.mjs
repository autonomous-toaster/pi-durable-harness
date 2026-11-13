import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertEncrypted, connectionHint, missingTenant, resolveSsl, SslConfigError } from "../dist/storage/postgres/ssl.js";
import { connectionOptions, resolveConnection } from "../dist/storage/postgres/connection.js";

const dir = mkdtempSync(join(tmpdir(), "pi-ssl-"));
const caPath = join(dir, "ca.pem");
writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
const url = "postgres://user@db.example.com:5432/harness";
const pooler = "postgres://postgres:pw@aws-0-region.pooler.example.com:6543/postgres";

test("no mode leaves TLS to the driver's default", () => {
	assert.deepEqual(resolveSsl({ url, env: {} }), { mode: "disable", enforce: false });
});

test("sslmode in the URL is honoured, and the prefixed mode overrides it", () => {
	const fromUrl = resolveConnection({ url: `${url}?sslmode=require`, env: {} }).ssl;
	assert.equal(fromUrl.mode, "require");
	const overridden = resolveConnection({ url: `${url}?sslmode=verify-full`, env: { PI_DURABLE_PGSSLMODE: "require" } }).ssl;
	assert.equal(overridden.mode, "require");
});

test("a root certificate is read, and verification is what the mode promises", () => {
	const verified = resolveConnection({ url, env: { PI_DURABLE_PGSSLMODE: "verify-full", PI_DURABLE_PGSSLROOTCERT: caPath } }).ssl;
	assert.equal(verified.enforce, true);
	assert.equal(verified.ssl.rejectUnauthorized, true);
	assert.match(verified.ssl.ca, /BEGIN CERTIFICATE/);

	const encryptedOnly = resolveConnection({ url, env: { PI_DURABLE_PGSSLMODE: "require" } }).ssl;
	assert.equal(encryptedOnly.enforce, true);
	assert.equal(encryptedOnly.ssl.rejectUnauthorized, false);
});

test("a verifying mode without a root certificate is refused, naming the setting", () => {
	assert.throws(() => resolveSsl({ url, env: {}, mode: "verify-ca" }), /PI_DURABLE_PGSSLROOTCERT/);
	assert.throws(() => resolveSsl({ url, env: {}, mode: "verify-full" }), SslConfigError);
});

test("the modes with a plaintext fallback are refused", () => {
	for (const mode of ["allow", "prefer"]) {
		assert.throws(() => resolveSsl({ url, env: {}, mode }), /plaintext fallback/, mode);
	}
});

test("an unknown mode names the accepted ones", () => {
	assert.throws(() => resolveSsl({ url, env: {}, mode: "maybe" }), /disable, require, verify-ca, verify-full/);
});

test("a client certificate needs its key", () => {
	assert.throws(
		() => resolveSsl({ url, env: {}, mode: "require", certificate: caPath }),
		/PI_DURABLE_PGSSLCERT and PI_DURABLE_PGSSLKEY/,
	);
});

test("an unencrypted connection is reported as an error", async () => {
	const plain = { query: async () => ({ rows: [{ ssl: false }] }) };
	await assert.rejects(() => assertEncrypted(plain), /not encrypted/);
	const encrypted = { query: async () => ({ rows: [{ ssl: true }] }) };
	await assertEncrypted(encrypted);
});

test("a pooler gets the server name, so Supavisor can find the tenant", () => {
	const env = { PI_DURABLE_PGSSLMODE: "verify-full", PI_DURABLE_PGSSLROOTCERT: caPath };
	const poolerConnection = resolveConnection({ url: pooler, env });
	assert.equal(connectionOptions(poolerConnection).ssl.servername, "aws-0-region.pooler.example.com");
	// An IP cannot be a TLS server name.
	const byIp = resolveConnection({ url: "postgres://postgres:pw@10.0.0.5:5432/postgres", env });
	assert.equal(connectionOptions(byIp).ssl.servername, undefined);
	// A declared name wins over the host.
	const declared = { ...env, PI_DURABLE_PG_SSL_SERVERNAME: "db.example.com" };
	assert.equal(connectionOptions(resolveConnection({ url: pooler, env: declared })).ssl.servername, "db.example.com");
});

test("ENOIDENTIFIER is explained rather than echoed", () => {
	const hint = connectionHint(pooler, new Error("(ENOIDENTIFIER) no tenant identifier provided"));
	assert.match(hint, /postgres\.<project-ref>/);
	assert.match(hint, /SERVERNAME does not help/);
	assert.equal(connectionHint(url, new Error("connection refused")), undefined);
});

test("a pooler URL without a tenant says so before connecting", () => {
	assert.match(missingTenant(pooler), /postgres\.<project-ref>/);
	assert.equal(missingTenant("postgres://postgres.abcdefgh:pw@aws-0-region.pooler.example.com:6543/postgres"), undefined);
	assert.equal(missingTenant("postgres://postgres:pw@db.example.com:5432/postgres"), undefined);
});
