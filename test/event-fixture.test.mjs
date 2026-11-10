/**
 * Event projection conformance against the pinned pi capture (tasks 4.1-4.3, 4.7, 7.1).
 *
 * Runs the built harness in RPC mode against the same mock model the fixture was
 * captured from and compares the record stream to `test/fixtures/pi-<version>/events.ndjson`.
 * The harness also emits `entry_appended`, a record pi does not, so the
 * comparison is over the records both produce: every type pi emits must appear,
 * and each shared type must carry the same field names.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
				hasToolResult = (JSON.parse(body).messages ?? []).some((message) => message.role === "tool");
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

async function harnessRecords(agentDir) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(root, "dist", "cli.js"), "--mode", "rpc", "--no-session", "-ne", "-ns", "-np", "-nc", "--provider", "mock", "--model", "mock-1"], {
			cwd: root,
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const records = [];
		let buffer = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`timeout; ${records.length} records\n${stderr.slice(-500)}`));
		}, 60_000);
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			let at;
			while ((at = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
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
			if (!records.some((record) => record.type === "agent_settled")) reject(new Error(`never settled\n${stderr.slice(-500)}`));
			else resolve(records);
		});
		child.stdin.write(`${JSON.stringify({ id: "p1", type: "prompt", message: "Say hi." })}\n`);
		child.stdin.on("error", () => {});
	});
}

test("the harness emits pi's event records for the same run", async () => {
	const fixtureDir = join(root, "test", "fixtures", "pi-1.5.2");
	const fixture = (await readFile(join(fixtureDir, "events.ndjson"), "utf8"))
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line))
		.filter((record) => record.type !== "response");

	const server = await startMockModel();
	const agentDir = await mkdtemp(join(tmpdir(), "harness-events-"));
	let records;
	try {
		await writeFile(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					mock: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", apiKey: "mock", models: [{ id: "mock-1" }] },
				},
			}),
		);
		records = await harnessRecords(agentDir);
	} finally {
		server.close();
		await rm(agentDir, { recursive: true, force: true });
	}

	// A harness-only record: pi reads entries through `get_entries` instead.
	const ours = records.filter((record) => record.type !== "response" && record.type !== "entry_appended");
	const ourTypes = new Set(ours.map((record) => record.type));

	for (const record of fixture) {
		assert.ok(ourTypes.has(record.type), `expected ${record.type} in ${[...ourTypes].join(", ")}`);
	}

	// Field-name parity for every type both sides emit.
	for (const type of ourTypes) {
		const theirs = fixture.find((record) => record.type === type);
		if (theirs === undefined) continue;
		const oursFields = [...new Set(ours.filter((record) => record.type === type).flatMap((record) => Object.keys(record)))].sort();
		const theirsFields = [...new Set(fixture.filter((record) => record.type === type).flatMap((record) => Object.keys(record)))].sort();
		assert.deepEqual(oursFields, theirsFields, `${type} fields differ`);
	}

	assert.equal(ours.at(-1).type, "agent_settled", "settle comes last");
	assert.ok(!ourTypes.has("snapshot"), "no snapshot is replayed");
});
