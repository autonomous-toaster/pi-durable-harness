#!/usr/bin/env node
// Minimal external pi-RPC client for the harness.
//
// Usage:
//   node tools/rpc-call.mjs [harness args ...] -- '<command json>' ['<command json>' ...]
//
// Everything before `--` is passed to the harness; everything after is sent as
// commands. Sends each command as one JSONL record, prints every record the
// harness emits, and exits once all commands have responded — waiting for
// `agent_settled` first when one of them starts a run. The harness runs with
// the current environment, so PI_DURABLE_DATABASE_URL selects PostgreSQL.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const harnessArgs = split === -1 ? [] : argv.slice(0, split);
const commands = (split === -1 ? argv : argv.slice(split + 1)).map((text) => JSON.parse(text));

const child = spawn(process.execPath, [join(root, "dist", "cli.js"), ...harnessArgs], {
	cwd: root,
	env: process.env,
	stdio: ["pipe", "pipe", "inherit"],
});

const runCommands = new Set(["prompt", "steer", "follow_up"]);
const expectsRun = commands.some((command) => runCommands.has(command.type));
let responses = 0;
let settled = !expectsRun;
let buffer = "";

child.stdout.on("data", (chunk) => {
	buffer += chunk.toString("utf8");
	let at;
	while ((at = buffer.indexOf("\n")) !== -1) {
		const line = buffer.slice(0, at);
		buffer = buffer.slice(at + 1);
		if (line.length === 0) continue;
		process.stdout.write(`${line}\n`);
		const record = JSON.parse(line);
		// A prompt response does not mean the run finished; wait for agent_settled.
		if (record.type === "response" && (record.command !== "prompt" || !expectsRun)) {
			responses += 1;
			if (responses >= commands.length && settled) finish(0);
		}
		if (record.type === "agent_settled") {
			settled = true;
			if (responses >= commands.length) finish(0);
		}
	}
});

let done = false;
function finish(code) {
	if (done) return;
	done = true;
	child.stdin.end();
	setTimeout(() => {
		child.kill("SIGKILL");
		process.exit(code);
	}, 200);
}

const timer = setTimeout(() => {
	process.stderr.write("rpc-call: timed out\n");
	finish(1);
}, 180_000);

child.on("error", (error) => {
	clearTimeout(timer);
	process.stderr.write(`${error.message}\n`);
	finish(1);
});
child.on("close", () => {
	clearTimeout(timer);
	if (!done) {
		process.stderr.write("rpc-call: harness exited before all responses\n");
		process.exit(1);
	}
});

for (const [index, command] of commands.entries()) {
	child.stdin.write(`${JSON.stringify({ id: `c${index + 1}`, ...command })}\n`);
}
