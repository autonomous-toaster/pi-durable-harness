#!/usr/bin/env node
// Local check runner: type checks, build, then tests (which include the
// fixture replay). CI wiring is deferred; this is the supported local gate.
import { spawnSync } from "node:child_process";

const steps = [
	{ name: "typecheck", command: "npm", args: ["run", "typecheck"] },
	{ name: "build", command: "npm", args: ["run", "build"] },
	{ name: "test", command: "node", args: ["--test"] },
];

let failed = 0;
for (const step of steps) {
	process.stdout.write(`\n=== ${step.name} ===\n`);
	const result = spawnSync(step.command, step.args, { stdio: "inherit", shell: process.platform === "win32" });
	if (result.status !== 0) {
		failed += 1;
		process.stderr.write(`step failed: ${step.name}\n`);
	}
}

process.stdout.write(`\n${failed === 0 ? "all checks passed" : `${failed} check(s) failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
