#!/usr/bin/env node
// Acceptance client for task 9.2: spawn the harness as an external pi-RPC
// client would and drive it over stdio. Set PI_ACCEPT_PROMPT=1 to run a model
// prompt and wait for agent_settled; otherwise only the state command runs.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [join(root, "dist", "cli.js"), "--no-session"], {
	cwd: root,
	env: { ...process.env, PI_OFFLINE: "1" },
	stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const records = [];
const expected = process.env.PI_ACCEPT_PROMPT === "1" ? 2 : 1;
let responses = 0;

child.stdout.on("data", (chunk) => {
	buffer += chunk.toString("utf8");
	let at;
	while ((at = buffer.indexOf("\n")) !== -1) {
		const line = buffer.slice(0, at);
		buffer = buffer.slice(at + 1);
		if (line.length === 0) continue;
		const record = JSON.parse(line);
		records.push(record.type);
		if (record.type === "response") {
			responses += 1;
			if (responses === 1) child.stdin.write(`${JSON.stringify({ id: "p1", type: "prompt", message: "Reply with the single word: ok" })}\n`);
		}
		if (record.type === "agent_settled") {
			finish(0);
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
		process.stdout.write(`records: ${records.join(", ")}\n`);
		process.exit(code);
	}, 200);
}

const timer = setTimeout(() => {
	process.stderr.write(`timeout; records: ${records.join(", ")}\n`);
	finish(1);
}, 180_000);

child.on("error", (error) => {
	process.stderr.write(`${error.message}\n`);
	clearTimeout(timer);
	finish(1);
});
child.on("close", () => {
	clearTimeout(timer);
	if (!done) {
		const ok = records.includes("response") && (process.env.PI_ACCEPT_PROMPT !== "1" || records.includes("agent_settled"));
		finish(ok ? 0 : 1);
	}
});

child.stdin.write(`${JSON.stringify({ id: "s1", type: "get_state" })}\n`);
