/**
 * `--help` documents what the parser actually accepts, and says nothing on stderr
 * (a backend loaded eagerly would print Node's SQLite notice here).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolveConfig } from "../dist/harness/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("--help lists the flags and the environment", () => {
	const run = spawnSync(process.execPath, [join(root, "dist", "cli.js"), "--help"], { encoding: "utf8" });
	assert.equal(run.status, 0);
	assert.equal(run.stderr, "", "help writes nothing to stderr");
	for (const expected of [
		"--mode rpc",
		"--session-id <id>",
		"--session <id>",
		"-c, --continue",
		"-n, --name <name>",
		"--tenant <name>",
		"--session-dir <dir>",
		"--no-session",
		"--system-prompt <text|path>",
		"--append-system-prompt <text|path>",
		"--provider <name>",
		"--thinking <level>",
		"PI_DURABLE_DATABASE_URL",
		"PI_DURABLE_PG_SCHEMA",
		"PI_DURABLE_PERSIST_WITHIN_MS",
		"PI_CODING_AGENT_DIR",
		"PI_CODING_AGENT_SESSION_DIR",
		"PI_OFFLINE",
	]) {
		assert.ok(run.stdout.includes(expected), `help mentions ${expected}`);
	}
});

test("-p selects print mode", () => {
	assert.equal(resolveConfig(["-p", "hello"], {}, "/w").interfaceName, "print");
	assert.equal(resolveConfig(["--print", "hello"], {}, "/w").interfaceName, "print");
	// An explicit RPC mode still wins, so a stray token cannot switch it.
	assert.equal(resolveConfig(["--mode", "rpc", "-p"], {}, "/w").interfaceName, "rpc");
});
