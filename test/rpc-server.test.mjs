import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { RpcServer } from "../dist/rpc/server.js";

function stubSession(overrides = {}) {
	return {
		sessionId: "s1",
		async state() {
			return { sessionId: "s1", sessionFile: null, messageCount: 0, pendingMessageCount: 0 };
		},
		async submit(message, _images, behavior) {
			return { disposition: behavior ?? "started", message };
		},
		async abort() {},
		async clearQueue() {},
		async compact() {},
		async messages() {
			return { messages: [] };
		},
		async entries() {
			return { entries: [], leafId: null };
		},
		async tree() {
			return { tree: [], leafId: null };
		},
		async lastAssistantText() {
			return {};
		},
		async sessionStats() {
			return { totalMessages: 0 };
		},
		async availableModels() {
			return { models: [] };
		},
		async setModel(provider, modelId) {
			return provider === "bad" ? { ok: false, error: `Model not found: ${provider}/${modelId}` } : { ok: true };
		},
		async setThinkingLevel() {},
		async availableThinkingLevels() {
			return { levels: ["off", "high"] };
		},
		async setSteeringMode() {},
		async setFollowUpMode() {},
		async bash(_command, onOutput) {
			onOutput("hi\n");
			return { output: "hi\n", exitCode: 0 };
		},
		async abortBash() {},
		async getCommands() {
			return { commands: [] };
		},
		async startEvents() {
			return async () => {};
		},
		...overrides,
	};
}

async function run(lines, overrides) {
	const input = new PassThrough();
	const output = new PassThrough();
	const records = [];
	output.on("data", (chunk) => {
		for (const line of chunk.toString("utf8").split("\n")) if (line.length > 0) records.push(JSON.parse(line));
	});
	const server = new RpcServer(stubSession(overrides), input, output);
	const running = server.run();
	for (const line of lines) input.write(`${line}\n`);
	input.end();
	await running;
	return records;
}

test("responses repeat the command id", async () => {
	const records = await run(['{"id":"a","type":"get_state"}', '{"id":"b","type":"get_available_thinking_levels"}']);
	assert.equal(records.length, 2);
	assert.equal(records[0].id, "a");
	assert.equal(records[0].command, "get_state");
	assert.equal(records[0].success, true);
	assert.equal(records[1].id, "b");
	assert.deepEqual(records[1].data.levels, ["off", "high"]);
});

test("malformed JSON is answered without a command or id", async () => {
	const records = await run(["{ this is not json"]);
	assert.equal(records.length, 1);
	assert.equal(records[0].type, "response");
	assert.equal(records[0].success, false);
	assert.equal(records[0].id, undefined);
	assert.equal(records[0].command, undefined);
});

test("an unknown command is answered by name", async () => {
	const records = await run(['{"id":"x","type":"no_such_command"}']);
	assert.equal(records[0].command, "no_such_command");
	assert.equal(records[0].success, false);
	assert.match(records[0].error, /Unknown command/);
});

test("extension_ui_response is ignored", async () => {
	const records = await run(['{"type":"extension_ui_response","id":"u1"}', '{"id":"a","type":"get_state"}']);
	assert.equal(records.length, 1);
	assert.equal(records[0].id, "a");
});

test("a failed set_model reports the error", async () => {
	const records = await run(['{"id":"m","type":"set_model","provider":"bad","modelId":"x"}']);
	assert.equal(records[0].success, false);
	assert.match(records[0].error, /Model not found/);
});

test("bash streams output with the command id then responds", async () => {
	const records = await run(['{"id":"req-1","type":"bash","command":"echo hi"}']);
	assert.equal(records[0].type, "bash_execution_update");
	assert.equal(records[0].id, "req-1");
	assert.equal(records[0].delta, "hi\n");
	assert.equal(records[1].command, "bash");
	assert.equal(records[1].success, true);
});

test("session, policy, and export commands are dispatched", async () => {
	const calls = [];
	const records = await run(
		[
			'{"id":"n","type":"new_session"}',
			'{"id":"e","type":"export_html","outputPath":"/tmp/x.html"}',
			'{"id":"t","type":"cycle_thinking_level"}',
			'{"id":"s","type":"set_session_name","name":"demo"}',
			'{"id":"c","type":"set_auto_compaction","enabled":true}',
		],
		{
			async newSession() {
				calls.push("new_session");
				return { canceled: false };
			},
			async exportHtml(path) {
				calls.push("export_html");
				return { path };
			},
			async cycleThinkingLevel() {
				return { level: "high" };
			},
			async setSessionName(name) {
				calls.push(`name:${name}`);
			},
			async setAutoCompaction(enabled) {
				calls.push(`auto:${enabled}`);
			},
		},
	);
	assert.deepEqual(calls, ["new_session", "export_html", "name:demo", "auto:true"]);
	assert.equal(records.find((r) => r.id === "e").data.path, "/tmp/x.html");
	assert.equal(records.find((r) => r.id === "t").data.level, "high");
	assert.deepEqual(records.map((r) => r.success), [true, true, true, true, true]);
});
