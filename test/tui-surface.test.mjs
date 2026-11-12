import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// pi's TUI names every member it needs, so the adapter is checked against pi's own
// code rather than against a list someone remembered to update. A missing member is
// a crash the first time that command runs (getSessionStats, isPersisted, agentDir).
test("the adapter provides every member pi's TUI reaches for", () => {
	const output = execFileSync(process.execPath, [join(root, "tools", "tui-surface.mjs"), "--check"], {
		cwd: root,
		encoding: "utf8",
	});
	const summary = output.trim().split("\n").at(-1) ?? "";
	assert.match(summary, /^\d+\/\d+ members provided$/, output.split("\n").filter((line) => line.startsWith("MISS")).join("\n"));
	assert.ok(!output.includes("MISS "), output.split("\n").filter((line) => line.startsWith("MISS")).join("\n"));
	// A member that exists but returns the wrong shape crashes the command that uses it
	// (clearQueue() is destructured on escape).
	assert.ok(!output.includes("SHAPE "), output.split("\n").filter((line) => line.startsWith("SHAPE")).join("\n"));
});
