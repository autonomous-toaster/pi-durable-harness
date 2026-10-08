#!/usr/bin/env node
// Differential harness (tasks 6.1, 6.2): run pi and this harness against the
// same mcp.json and a mock model endpoint, capture both model requests, and
// diff the declared tools and the system prompt.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const requests = [];

/** OpenAI-compatible streaming endpoint that records each request body. */
function startMockModel() {
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			if (req.method === "POST" && req.url?.includes("/chat/completions")) {
				try {
					requests.push(JSON.parse(body));
				} catch {
					requests.push({ unparsed: body });
				}
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
				const chunk = (delta, finish) =>
					`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
				res.write(chunk({ role: "assistant", content: "ok" }, null));
				res.write(chunk({}, "stop"));
				res.write("data: [DONE]\n\n");
				res.end();
				return;
			}
			res.writeHead(404).end();
		});
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Run a command to completion, optionally writing stdin and ending it on a stdout marker. */
function run(command, args, env, stdin) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			if (stdin !== undefined && stdout.includes(stdin.until)) child.stdin.end();
		});
		child.stderr.on("data", (chunk) => (stderr += chunk));
		const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
		if (stdin !== undefined) child.stdin.write(stdin.data);
		else child.stdin.end();
	});
}

const server = await startMockModel();
const port = server.address().port;
const cwd = await mkdtemp(join(tmpdir(), "harness-diff-"));
await writeFile(
	join(cwd, "mcp.json"),
	JSON.stringify({
		mcpServers: {
			fake: {
				command: process.execPath,
				args: [join(root, "tools", "fake-mcp-server.mjs")],
				exposure: "codemode",
				toolExposure: { direct_tool: "direct", defer_tool: "deferred" },
			},
		},
	}),
);
await writeFile(
	join(cwd, "models.json"),
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

const env = { PI_CODING_AGENT_DIR: cwd, PI_OFFLINE: "1" };
const piRun = await run(
	process.execPath,
	[join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"), "--provider", "mock", "--model", "mock-1", "--no-session", "-p", "hi"],
	env,
);
const piRequest = requests.at(-1);
const harnessRun = await run(
	process.execPath,
	[join(root, "dist", "cli.js"), "--provider", "mock", "--model", "mock-1", "--no-session"],
	env,
	{ data: '{"id":"1","type":"prompt","message":"hi"}\n', until: "agent_settled" },
);
server.close();
await rm(cwd, { recursive: true, force: true });

if (piRequest === undefined || harnessRun.stdout.includes('"success":false')) {
	process.stderr.write(`pi exit ${piRun.code}, harness failed\n${harnessRun.stdout}\n${harnessRun.stderr}\n`);
	process.exit(1);
}
const harnessRequest = requests.at(-1);
if (harnessRequest === piRequest) {
	process.stderr.write(`captured ${requests.length} request(s); the harness made none\n${harnessRun.stderr}\n`);
	process.exit(1);
}

const toolView = (request) =>
	(request.tools ?? []).map((tool) => ({
		name: tool.function?.name ?? tool.name,
		description: tool.function?.description ?? tool.description,
		parameters: tool.function?.parameters ?? tool.parameters,
	}));
const systemText = (request) =>
	(request.messages ?? [])
		.filter((message) => message.role === "system" || message.role === "developer")
		.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
		.join("\n");

const piTools = toolView(piRequest);
const harnessTools = toolView(harnessRequest);
console.log("pi tools:      ", piTools.map((tool) => tool.name));
console.log("harness tools: ", harnessTools.map((tool) => tool.name));

const diffs = [];
const piByName = new Map(piTools.map((tool) => [tool.name, tool]));
for (const tool of harnessTools) {
	const other = piByName.get(tool.name);
	if (other === undefined) continue;
	if (other.description !== tool.description) {
		diffs.push(`${tool.name}: description differs`);
		console.error(`  pi      ${tool.name} tail: ${JSON.stringify(other.description?.slice(-160))}`);
		console.error(`  harness ${tool.name} tail: ${JSON.stringify(tool.description?.slice(-160))}`);
	}
	if (JSON.stringify(other.parameters) !== JSON.stringify(tool.parameters)) diffs.push(`${tool.name}: parameters differ`);
}
if (systemText(piRequest) !== systemText(harnessRequest)) {
	diffs.push("system prompt differs");
	await writeFile("/tmp/pi-system.txt", systemText(piRequest));
	await writeFile("/tmp/harness-system.txt", systemText(harnessRequest));
}
for (const diff of diffs) console.error(`DIFF: ${diff}`);
if (diffs.length === 0) console.log("differential: no difference");
process.exit(diffs.length === 0 ? 0 : 1);
