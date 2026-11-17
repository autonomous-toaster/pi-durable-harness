#!/usr/bin/env node
// Local check runner: type checks, build, then tests (which include the
// fixture replay). CI wiring is deferred; this is the supported local gate.
import { spawnSync } from "node:child_process";

const steps = [
	{ name: "typecheck", command: "npm", args: ["run", "typecheck"] },
	{ name: "build", command: "npm", args: ["run", "build"] },
	{ name: "test", command: "node", args: ["--test"] },
];

/**
 * What the working tree looks like, as one sorted list. The suite must leave it exactly as it
 * found it: a test that writes into the repository (an export with a default path, a fixture, a
 * cache) is how generated files end up committed.
 */
function treeState() {
	const result = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
	if (result.status !== 0) return undefined;
	return result.stdout.split("\n").filter((line) => line.length > 0).sort();
}

let failed = 0;
for (const step of steps) {
	process.stdout.write(`\n=== ${step.name} ===\n`);
	const before = step.name === "test" ? treeState() : undefined;
	const result = spawnSync(step.command, step.args, { stdio: "inherit", shell: process.platform === "win32" });
	if (result.status !== 0) {
		failed += 1;
		process.stderr.write(`step failed: ${step.name}\n`);
	}
	if (before !== undefined) {
		const after = treeState();
		const added = (after ?? []).filter((line) => !before.includes(line));
		if (added.length > 0) {
			failed += 1;
			process.stderr.write(`step left the working tree dirty: ${step.name}\n  ${added.join("\n  ")}\n`);
		}
	}
}

process.stdout.write(`\n${failed === 0 ? "all checks passed" : `${failed} check(s) failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
