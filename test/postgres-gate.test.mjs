/**
 * The gate's own behaviour (tasks 1.2, 2.1).
 *
 * A suite that skips in CI is how a process-fatal PostgreSQL bug reached a commit, so the skip is
 * only legal locally. The driver discipline is checked the same way: read a number without changing
 * what every other `pg` consumer in the process parses.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Run the helper in a child so the environment is exactly what the test describes. */
function helper(overrides) {
	const env = { ...process.env, ...overrides };
	for (const [key, value] of Object.entries(overrides)) if (value === "") delete env[key];
	return spawnSync(process.execPath, ["--input-type=module", "-e", 'const m = await import("./test/support-database.mjs"); console.log(JSON.stringify(m.testDatabase()));'], {
		cwd: root,
		encoding: "utf8",
		env,
	});
}

test("a gate without a database fails instead of skipping", () => {
	const result = helper({ CI: "true", TEST_DATABASE_URL: "" });
	assert.notEqual(result.status, 0, "the helper must throw when the gate has no database");
	assert.match(result.stderr, /TEST_DATABASE_URL is required in the gate/);
});

test("a developer machine without a database skips", () => {
	const result = helper({ CI: "", TEST_DATABASE_URL: "" });
	assert.equal(result.status, 0, result.stderr);
	const parsed = JSON.parse(result.stdout.trim());
	assert.equal(parsed.url, undefined);
	assert.match(String(parsed.skip), /no TEST_DATABASE_URL/);
});

test("a configured database runs in both", () => {
	for (const env of [{ CI: "true" }, { CI: "" }]) {
		const result = helper({ ...env, TEST_DATABASE_URL: "postgres://example/db" });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(JSON.parse(result.stdout.trim()).url, "postgres://example/db");
	}
});
