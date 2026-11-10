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
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
	const records = await capture(
		piBin,
		commands,
	);
	const text = records.map((record) => JSON.stringify(record)).join("\n");
	await writeFile(join(outDir, `${name}.ndjson`), `${text}\n`);
	process.stdout.write(`${name}: ${records.length} records\n`);
}

// Task 1.5: one scripted run, captured as pi's RPC event stream. A mock
// OpenAI-compatible endpoint answers the first request of each run with one
// `bash` tool call and the next with a final text, so the capture needs no
// credentials and exercises the message, tool, and settle paths.
await captureEventScenario(outDir);
process.stdout.write(`fixtures written to ${outDir}\n`);

/** Streaming endpoint that alternates a tool call and a final answer per run. */
function startMockModel() {
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => {
			if (request.method !== "POST" || request.url?.includes("/chat/completions") !== true) {
				response.writeHead(404).end();
				return;
			}
			let hasToolResult = false;
			try {
				const parsed = JSON.parse(body);
				hasToolResult = (parsed.messages ?? []).some((message) => message.role === "tool");
			} catch {
				hasToolResult = false;
			}
			response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			const frame = (delta, finish) =>
				`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
			if (!hasToolResult) {
				response.write(
					frame(
						{
							role: "assistant",
							tool_calls: [
								{ index: 0, id: "call_1", type: "function", function: { name: "bash", arguments: '{"command":"printf hi"}' } },
							],
						},
						null,
					),
				);
				response.write(frame({}, "tool_calls"));
			} else {
				response.write(frame({ role: "assistant", content: "done" }, null));
				response.write(frame({}, "stop"));
			}
			response.write("data: [DONE]\n\n");
			response.end();
		});
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Run pi RPC over stdio and collect records until `agent_settled`. */
function captureRun(command, args, env, prompt, timeoutMs = 60_000) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
		const records = [];
		let buffer = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`timeout; ${records.length} records\n${stderr.slice(-500)}`));
		}, timeoutMs);
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			let at;
			while ((at = buffer.indexOf("\n")) !== -1) {
				let line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
				if (line.endsWith("\r")) line = line.slice(0, -1);
				if (line.length === 0) continue;
				const record = JSON.parse(line);
				records.push(record);
				if (record.type === "agent_settled") {
					clearTimeout(timer);
					child.stdin.end();
				}
			}
		});
		child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
		child.on("error", reject);
		child.on("close", () => {
			clearTimeout(timer);
			if (!records.some((record) => record.type === "agent_settled")) {
				reject(new Error(`pi exited before settling\n${stderr.slice(-500)}`));
				return;
			}
			resolve(records);
		});
		child.stdin.write(`${JSON.stringify({ id: "p1", type: "prompt", message: prompt })}\n`);
		child.stdin.on("error", () => {});
	});
}

/** Capture the event stream of one scripted run against a mock model. */
async function captureEventScenario(targetDir) {
	const server = await startMockModel();
	const port = server.address().port;
	const agentDir = await mkdtemp(join(tmpdir(), "harness-events-"));
	try {
		await writeFile(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					mock: {
						baseUrl: `http://127.0.0.1:${port}/v1`,
						api: "openai-completions",
						apiKey: "mock",
						models: [{ id: "mock-1" }],
					},
				},
			}),
		);
		const args = ["--mode", "rpc", "--no-session", "-ne", "-ns", "-np", "-nc", "--provider", "mock", "--model", "mock-1"];
		const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
		const records = await captureRun(piBin, args, env, "Say hi.");
		const text = records.map((record) => JSON.stringify(record)).join("\n");
		await writeFile(join(targetDir, "events.ndjson"), `${text}\n`);
		process.stdout.write(`events: ${records.length} records\n`);
	} finally {
		server.close();
		await rm(agentDir, { recursive: true, force: true });
	}
}
