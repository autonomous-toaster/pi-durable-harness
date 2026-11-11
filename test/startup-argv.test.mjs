/**
 * The Open Terminal launch contract (tasks 1.4, 4.1).
 *
 * Open Terminal's `open_terminal/agents/pi.py` builds exactly this argv, with
 * `--append-system-prompt` last when instructions are set. It must start an RPC
 * server: JSONL on stdout, a `get_state` response, and a process that stays up.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function runRpc(args, command, timeoutMs = 20_000) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(root, "dist", "cli.js"), ...args], {
			cwd: root,
			env: { ...process.env, PI_OFFLINE: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const records = [];
		let buffer = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`timeout; ${records.length} records\n${stderr.slice(-400)}`));
		}, timeoutMs);
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			let at;
			while ((at = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
				if (line.length === 0) continue;
				records.push(JSON.parse(line));
			}
		});
		child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
		child.on("error", reject);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ records, code, stderr });
		});
		child.stdin.write(`${JSON.stringify(command)}\n`);
		// Give the server time to answer, then close its stdin so it exits.
		setTimeout(() => child.stdin.end(), 1500);
	});
}

test("Open Terminal's argv serves RPC", async () => {
	const { records, stderr } = await runRpc(
		["--mode", "rpc", "--session-id", "0123456789abcdef", "--append-system-prompt", "Be brief."],
		{ id: "s1", type: "get_state" },
	);
	const response = records.find((record) => record.type === "response" && record.id === "s1");
	assert.ok(response, `a get_state response arrived; stderr: ${stderr}`);
	assert.equal(response.success, true);
	assert.equal(typeof response.data.sessionId, "string");
});

test("an ignored pi value flag does not become a prompt", async () => {
	const { records } = await runRpc(
		["--mode", "rpc", "--session-id", "s2", "--theme", "dark", "--models", "a,b", "--append-system-prompt", "Be brief."],
		{ id: "s1", type: "get_state" },
	);
	assert.ok(records.some((record) => record.type === "response" && record.id === "s1"));
});
