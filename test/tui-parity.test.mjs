/**
 * TUI parity, end to end (task 7.1): pi's InteractiveMode boots over the durable
 * engine, a prompt typed into pi's editor reaches the model, and the render is
 * pi's own layout.
 *
 * Opt-in, because it calls a real provider:
 *   TEST_LIVE_MODEL=1 node --test test/tui-parity.test.mjs
 * TEST_LIVE_PROVIDER / TEST_LIVE_MODEL_ID override the model.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const live = process.env.TEST_LIVE_MODEL === "1";

/** Run the spike (pi's TUI over the durable engine) and return its output. */
function spike(env = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(root, "tools", "tui-spike.mjs")], {
			cwd: root,
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`timeout\n${stderr.slice(-500)}`));
		}, 180_000);
		child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
		child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
		child.on("error", reject);
		child.on("close", () => {
			clearTimeout(timer);
			resolve({ stdout, stderr });
		});
	});
}

test("pi's TUI boots on durable state, prompts, and renders pi's layout", { skip: !live, timeout: 200_000 }, async () => {
	const { stdout, stderr } = await spike({
		TEST_LIVE_PROVIDER: process.env.TEST_LIVE_PROVIDER ?? "ollama-cloud",
		TEST_LIVE_MODEL_ID: process.env.TEST_LIVE_MODEL_ID ?? "deepseek-v4.1-flash:cloud",
		TUI_SPIKE_PROMPT: "Reply with exactly: ok",
	});
	assert.ok(!stdout.includes("MODE ERROR"), `the TUI ran: ${stderr.slice(-400)}`);
	// The answer came back through durable, not from a fake.
	assert.match(stdout, /answer: "[^"]+"/);
	// pi's footer shows one resolved model — no "old -> new" arrow, which is what a
	// bogus routedModel drew — and pi's extension panel lists its runner's set.
	const footer = stdout.split("\n").find((line) => line.startsWith("FOOTER: ")) ?? "";
	assert.match(footer, /\(\w[\w-]*\) \S+ •/, footer);
	assert.doesNotMatch(footer, / → /, footer);
	assert.match(stdout, /\[Extensions\]/);
});
