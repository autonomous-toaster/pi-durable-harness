import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveConfig } from "../dist/harness/config.js";

test("reads pi flags and environment variables", () => {
	const config = resolveConfig(
		["--mode", "rpc", "--session-id", "kobo-7", "--provider", "openai", "--model", "gpt-6-sol", "-ne", "--offline"],
		{ PI_DURABLE_DATABASE_URL: "postgres://db", PI_CODING_AGENT_DIR: "/tmp/agent" },
		"/work",
	);
	assert.equal(config.mode, "rpc");
	assert.equal(config.sessionKey, "kobo-7");
	assert.equal(config.provider, "openai");
	assert.equal(config.model, "gpt-6-sol");
	assert.equal(config.databaseUrl, "postgres://db");
	assert.equal(config.agentDir, "/tmp/agent");
	assert.equal(config.sessionDir, "/tmp/agent/sessions");
	assert.equal(config.offline, true);
	assert.equal(config.warnings.length, 0);
});

test("flags the harness does not act on are ignored", () => {
	const config = resolveConfig(["--mode", "rpc", "--future-flag"], {}, "/work");
	assert.equal(config.mode, "rpc");
	assert.deepEqual(config.warnings, []);
});

test("continue and ephemeral are captured", () => {
	const config = resolveConfig(["-c", "--no-session"], {}, "/work");
	assert.equal(config.continueSession, true);
	assert.equal(config.ephemeral, true);
});

test("a missing flag value is reported", () => {
	const config = resolveConfig(["--model"], {}, "/work");
	assert.equal(config.model, undefined);
	assert.equal(config.warnings.length, 1);
});
