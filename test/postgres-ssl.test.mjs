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
	const options = poolOptions(url, { PI_DURABLE_PG_SSL: "verify-full", PI_DURABLE_PG_SSL_CA: caPath });
	assert.equal(options.connectionString, url);
	assert.equal(options.enforce, true);
	assert.equal(options.ssl.rejectUnauthorized, true);
});
