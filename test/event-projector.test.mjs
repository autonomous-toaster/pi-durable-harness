import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { Harness, MemoryStorage, createRegistry, defineExtension, section, watchEvents } from "@earendil-works/pi-durable";
import { EventProjector } from "../dist/harness/events.js";

const context = BACKGROUND_CONTEXT;

test("projects a run into pi lifecycle events and settles at quiescence", async () => {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([fauxAssistantMessage([fauxText("hello there")])]);

	const registry = createRegistry();
	registry.install(defineExtension({ name: "p", sections: [section("preamble", () => "You are concise.", { tag: false })] }));

	const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
	const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" } } });

	const records = [];
	const quiescent = async () => {
		const inspection = await harness.inspect(context);
		return inspection.tasks.length === 0
			&& !inspection.submissions.some((record) => record.status === "queued" || record.status === "placed");
	};
	const projector = new EventProjector((record) => records.push(record), quiescent);
	const stream = await watchEvents(harness, root.id, context);
	stream.start(async (events) => projector.handle(events));

	await (await root.submit({ type: "input", content: "hi" }, context)).wait(context);
	for (let attempt = 0; attempt < 50 && !records.some((r) => r.type === "agent_settled"); attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	await stream.stop();
	await harness.close(context);

	const types = records.map((record) => record.type);
	for (const expected of ["agent_start", "message_start", "message_end", "turn_start", "turn_end", "agent_end", "agent_settled"]) {
		assert.ok(types.includes(expected), `expected ${expected} in ${JSON.stringify(types)}`);
	}
	assert.ok(!types.includes("snapshot"), "the internal snapshot is never forwarded");
	assert.equal(types.at(-1), "agent_settled");
});

test("maps content changes to one assistant message event each", () => {
	const records = [];
	const projector = new EventProjector((record) => records.push(record), async () => true);
	projector.handle([
		{
			type: "message_update",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			changes: [
				{ type: "text_start", contentIndex: 0, block: { type: "text", text: "" } },
				{ type: "text_delta", contentIndex: 0, delta: "he" },
				{ type: "text_delta", contentIndex: 0, delta: "llo" },
				{ type: "block", contentIndex: 0, block: { type: "text", text: "hello" } },
			],
		},
	]);
	const updates = records.filter((record) => record.type === "message_update");
	assert.equal(updates.length, 4);
	assert.equal(updates[1].assistantMessageEvent.type, "text_delta");
	assert.equal(updates[1].assistantMessageEvent.delta, "he");
	assert.equal(updates[3].assistantMessageEvent.type, "text_end");
	assert.equal(updates[3].assistantMessageEvent.content, "hello");
});

test("maps tool output deltas into accumulated partial results", () => {
	const records = [];
	const projector = new EventProjector((record) => records.push(record), async () => true);
	projector.handle([
		{ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } },
		{ type: "tool_execution_update", toolCallId: "c1", toolName: "bash", output: { append: "a\n" } },
		{ type: "tool_execution_update", toolCallId: "c1", toolName: "bash", output: { append: "b\n" } },
	]);
	const updates = records.filter((record) => record.type === "tool_execution_update");
	assert.equal(updates.length, 2);
	assert.equal(updates[1].partialResult.content[0].text, "a\nb\n");
});

test("maps tool completion to result and error indicator", () => {
	const records = [];
	const projector = new EventProjector((record) => records.push(record), async () => true);
	projector.handle([
		{ type: "tool_execution_end", toolCallId: "c1", toolName: "bash", entry: { id: 5, conversationId: 1, kind: "pi.tool-result", model: [{ role: "toolResult", content: [], isError: true }] } },
	]);
	assert.equal(records[0].type, "tool_execution_end");
	assert.equal(records[0].isError, true);
	assert.equal(records[0].toolCallId, "c1");
});

test("maps inbox updates to queue_update and compaction and retry events", () => {
	const records = [];
	const projector = new EventProjector((record) => records.push(record), async () => true);
	projector.handle([
		{ type: "inbox_update", items: [{ id: 1, mode: "steer" }, { id: 2, mode: "followUp" }] },
		{ type: "compaction_start", taskId: 9, reason: "threshold", blocking: false },
		{ type: "compaction_end", taskId: 9, reason: "threshold" },
		{ type: "auto_retry_start", attempt: 1, at: 0, errorMessage: "overloaded" },
		{ type: "auto_retry_end", attempt: 1 },
	]);
	const queue = records.find((record) => record.type === "queue_update");
	assert.deepEqual(queue.steering, [1]);
	assert.deepEqual(queue.followUp, [2]);
	assert.equal(records.find((record) => record.type === "compaction_start").reason, "threshold");
	assert.equal(records.find((record) => record.type === "compaction_end").reason, "threshold");
	assert.equal(records.find((record) => record.type === "auto_retry_start").errorMessage, "overloaded");
	assert.equal(records.find((record) => record.type === "auto_retry_end").success, true);
});

test("the internal snapshot is never forwarded", () => {
	const records = [];
	const projector = new EventProjector((record) => records.push(record), async () => true);
	projector.handle([
		{ type: "snapshot", entries: [], tools: [], compactions: [], inbox: [], agent: {}, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
	]);
	assert.equal(records.length, 0);
});
