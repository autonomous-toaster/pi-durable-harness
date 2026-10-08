#!/usr/bin/env node
// Capture golden fixtures from the pinned pi CLI's RPC mode (task 1.3).
//
// Usage: node tools/capture-fixtures.mjs
//
// Runs `pi --mode rpc` with extensions/skills/prompt-templates/context files
// disabled so the captured records describe the built-in protocol, not the
// developer's personal resources. Each scenario writes one NDJSON file with
// the raw records pi emitted.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const piBin = join(root, "node_modules", ".bin", "pi");

/** Commands that never invoke a model, so capture needs no credentials. */
const SCENARIOS = {
	"read-commands": [
		{ id: "c1", type: "get_state" },
		{ id: "c2", type: "get_messages" },
		{ id: "c3", type: "get_entries" },
		{ id: "c4", type: "get_tree" },
		{ id: "c5", type: "get_last_assistant_text" },
		{ id: "c6", type: "get_session_stats" },
		{ id: "c7", type: "get_available_models" },
		{ id: "c8", type: "get_available_thinking_levels" },
		{ id: "c9", type: "get_commands" },
	],
	errors: [
		{ raw: "{ this is not json" },
		{ id: "e2", type: "no_such_command" },
		{ id: "e3", type: "set_model", provider: "no-such", modelId: "no-such" },
	],
};

const ARGS = ["--mode", "rpc", "--no-session", "-ne", "-ns", "-np", "-nc"];

function capture(command, input, timeoutMs = 30_000) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, ARGS, {
			cwd: root,
			env: { ...process.env, PI_OFFLINE: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const records = [];
		let buffer = "";
		const expected = input.filter((c) => typeof c.id === "string").length;
		let seen = 0;
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`timeout waiting for ${expected - seen} responses`));
		}, timeoutMs);

		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			let at;
			// Records split on LF only; a trailing "\r" is stripped for CRLF input.
			while ((at = buffer.indexOf("\n")) !== -1) {
				let line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
				if (line.endsWith("\r")) line = line.slice(0, -1);
				if (line.length === 0) continue;
				records.push(JSON.parse(line));
				if (JSON.parse(line).type === "response") seen += 1;
			}
			if (seen >= expected) {
				clearTimeout(timer);
				child.stdin.end();
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", reject);
		child.on("close", () => {
			clearTimeout(timer);
			if (seen < expected) {
				reject(new Error(`pi exited after ${seen}/${expected} responses\n${stderr.slice(-500)}`));
				return;
			}
			resolve(records);
		});

		for (const command of input) {
			child.stdin.write(`${JSON.stringify(command)}\n`);
		}
		child.stdin.on("error", () => {});
	});
}

async function piVersion() {
	return new Promise((resolve) => {
		const child = spawn(piBin, ["--version"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
		let out = "";
		child.stdout.on("data", (chunk) => (out += chunk.toString("utf8")));
		child.on("close", () => resolve(out.trim()));
	});
}

const version = (await piVersion()).replace(/^pi\s+/, "");
const outDir = join(root, "test", "fixtures", `pi-${version}`);
await mkdir(outDir, { recursive: true });

// Pinned dependency versions the corpus was captured against.
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const versions = {
	pi: { package: "@earendil-works/pi-coding-agent", version },
	harnessDependencies: pkg.dependencies,
	harnessDevDependencies: pkg.devDependencies,
	capturedWith: ARGS.join(" "),
};
await writeFile(join(outDir, "versions.json"), `${JSON.stringify(versions, null, "\t")}\n`);

for (const [name, commands] of Object.entries(SCENARIOS)) {
	const records = await capture(piBin, commands);
	const text = records.map((record) => JSON.stringify(record)).join("\n");
	await writeFile(join(outDir, `${name}.ndjson`), `${text}\n`);
	process.stdout.write(`${name}: ${records.length} records\n`);
}
process.stdout.write(`fixtures written to ${outDir}\n`);
