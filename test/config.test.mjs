import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("positional prompts select print mode", () => {
	const config = resolveConfig(["--print", "do", "something"], {}, "/work");
	assert.deepEqual(config.prompts, ["do", "something"]);
	assert.equal(config.print, true);
	assert.equal(config.interfaceName, "print");
});

test("a double dash ends option parsing", () => {
	const config = resolveConfig(["--", "-not-a-flag"], {}, "/work");
	assert.deepEqual(config.prompts, ["-not-a-flag"]);
});

test("--mode json selects json mode", () => {
	const config = resolveConfig(["--mode", "json", "hi"], {}, "/work");
	assert.equal(config.interfaceName, "json");
});

test("a positional prompt with rpc mode warns", () => {
	const config = resolveConfig(["--mode", "rpc", "hi"], {}, "/work");
	assert.ok(config.warnings.some((warning) => /RPC mode/.test(warning)));
});

test("no positional prompt keeps rpc mode", () => {
	const config = resolveConfig(["--mode", "rpc"], {}, "/work");
	assert.equal(config.interfaceName, "rpc");
});

test("the progress window defaults to zero and reads the environment", () => {
	assert.equal(resolveConfig([], {}, "/work").persistWithinMs, 0);
	assert.equal(resolveConfig([], { PI_DURABLE_PERSIST_WITHIN_MS: "250" }, "/work").persistWithinMs, 250);
	assert.equal(resolveConfig([], { PI_DURABLE_PERSIST_WITHIN_MS: "0" }, "/work").persistWithinMs, 0);
});

test("an invalid progress window warns and falls back to zero", () => {
	for (const value of ["-1", "abc", ""]) {
		const config = resolveConfig([], { PI_DURABLE_PERSIST_WITHIN_MS: value }, "/work");
		assert.equal(config.persistWithinMs, 0, `${value} falls back to 0`);
		assert.equal(config.warnings.length, 1, `${value} warns`);
	}
});

test("the harness settings bridge carries the progress window", async () => {
	const { createHarnessSettings } = await import("../dist/harness/settings.js");
	assert.equal(createHarnessSettings({}, { persistWithinMs: 250 }).progress.persistWithinMs, 250);
	assert.equal(createHarnessSettings({}).progress.persistWithinMs, 0);
});

test("the system prompt flags are recorded, append is repeatable", () => {
	const config = resolveConfig(["--mode", "rpc", "--system-prompt", "You are terse.", "--append-system-prompt", "One.", "--append-system-prompt", "Two."], {}, "/work");
	assert.equal(config.systemPrompt, "You are terse.");
	assert.deepEqual(config.appendSystemPrompt, ["One.", "Two."]);
	assert.equal(config.interfaceName, "rpc");
	assert.deepEqual(config.warnings, []);
});

test("a flag value that names an existing file resolves to its contents", () => {
	const dir = mkdtempSync(join(tmpdir(), "harness-args-"));
	try {
		const file = join(dir, "instructions.md");
		writeFileSync(file, "From the file.\n");
		assert.equal(resolveConfig(["--system-prompt", file], {}, dir).systemPrompt, "From the file.\n");
		assert.equal(resolveConfig(["--system-prompt", "not a file, just text"], {}, dir).systemPrompt, "not a file, just text");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a pi value flag does not leak its value into the prompts", () => {
	const config = resolveConfig(["--mode", "rpc", "--session-id", "s", "--theme", "dark", "--models", "a,b"], {}, "/work");
	assert.deepEqual(config.prompts, []);
	assert.equal(config.interfaceName, "rpc");
});

test("an explicit rpc mode ignores a positional argument", () => {
	const config = resolveConfig(["--mode", "rpc", "--session-id", "s", "--append-system-prompt", "Be brief."], {}, "/work");
	assert.equal(config.interfaceName, "rpc");
	assert.deepEqual(config.prompts, []);
	assert.deepEqual(config.appendSystemPrompt, ["Be brief."]);
});
