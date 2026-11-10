import assert from "node:assert/strict";
import { test } from "node:test";
import { EventProjector, RevisionQueue } from "../dist/harness/events.js";

/** A minimal ConversationView revision, as a synchronous observer delivers it. */
function revision(docs = {}, entries = [], ops = []) {
	return { kind: "value", retired: false, ops, value: { conversation: { id: "c" }, entries, docs } };
}

const projectorOf = (records, quiescent = async () => true) => new EventProjector((record) => records.push(record), quiescent);

test("a run start and end project to the lifecycle records and settle", async () => {
	const records = [];
	const projector = projectorOf(records);
	await projector.handle(revision({ "pi.live": { run: { taskId: "t", inputs: [], turns: 0 } } }));
	await projector.handle(revision({ "pi.live": {} }));
	assert.deepEqual(
		records.map((record) => record.type),
		["agent_start", "turn_start", "turn_end", "agent_end", "agent_settled"],
	);
});

test("generation text growth projects to one delta per change", async () => {
	const records = [];
	const projector = projectorOf(records);
	const live = (text) => ({ "pi.live": { run: { taskId: "t", inputs: [], turns: 0 }, generation: { attempt: 0, message: { role: "assistant", content: [{ type: "text", text }] } } } });
	await projector.handle(revision(live("he"), [], [["a", ["docs", "pi.live", "generation", "message", "content", 0, "text"], "he"]]));
	await projector.handle(revision(live("hello"), [], [["a", ["docs", "pi.live", "generation", "message", "content", 0, "text"], "llo"]]));
	const updates = records.filter((record) => record.type === "message_update");
	const deltas = updates.filter((record) => record.assistantMessageEvent.type === "text_delta");
	assert.deepEqual(
		deltas.map((record) => record.assistantMessageEvent.delta),
		["he", "llo"],
	);
	assert.equal(deltas[0].assistantMessageEvent.contentIndex, 0);
	assert.equal(updates[0].assistantMessageEvent.type, "text_start");
});

test("tool slots project to start, accumulated update, and end", async () => {
	const records = [];
	const projector = projectorOf(records);
	const live = (status, output) => ({
		"pi.live": { run: { taskId: "t", inputs: [], turns: 0 }, tools: [{ callId: "c1", name: "bash", status, output }] },
	});
	await projector.handle(revision(live("running", "a\n")));
	await projector.handle(revision(live("running", "a\nb\n")));
	await projector.handle(revision(live("done", "a\nb\n")));
	const updates = records.filter((record) => record.type === "tool_execution_update");
	assert.equal(updates.length, 2);
	assert.equal(updates[1].partialResult.content[0].text, "a\nb\n");
	assert.equal(records.filter((record) => record.type === "tool_execution_start").length, 1);
	assert.equal(records.filter((record) => record.type === "tool_execution_end").length, 1);
});

test("the inbox projects to one queue_update per change", async () => {
	const records = [];
	const projector = projectorOf(records);
	const inbox = (items) => ({ "pi.inbox": { items } });
	await projector.handle(revision(inbox([{ id: 1, mode: "steer" }, { id: 2, mode: "followUp" }])));
	await projector.handle(revision(inbox([{ id: 1, mode: "steer" }])));
	const queues = records.filter((record) => record.type === "queue_update");
	assert.equal(queues.length, 2);
	assert.deepEqual(queues[0].steering, [1]);
	assert.deepEqual(queues[0].followUp, [2]);
});

test("a compaction projects to its start and end records", async () => {
	const records = [];
	const projector = projectorOf(records);
	await projector.handle(revision({ "pi.live": { run: { taskId: "t", inputs: [], turns: 0 }, compactions: [{ taskId: "k", trigger: "threshold" }] } }));
	await projector.handle(revision({ "pi.live": { run: { taskId: "t", inputs: [], turns: 0 } } }));
	const start = records.find((record) => record.type === "compaction_start");
	const end = records.find((record) => record.type === "compaction_end");
	assert.equal(start.reason, "threshold");
	assert.equal(end.type, "compaction_end");
});

test("entries project to one message pair and an append each", async () => {
	const records = [];
	const projector = projectorOf(records);
	const entry = { id: 7, kind: "pi.user", model: [{ role: "user", content: "hi" }] };
	await projector.handle(revision({}, [entry]));
	assert.deepEqual(
		records.map((record) => record.type),
		["message_start", "message_end", "entry_appended"],
	);
	assert.deepEqual(records[0].message, { role: "user", content: "hi" });
});

test("a seeded attachment replays no entry", async () => {
	const records = [];
	const projector = projectorOf(records);
	const entry = { id: 7, kind: "pi.user", model: [{ role: "user", content: "hi" }] };
	projector.seed(revision({}, [entry]).value);
	await projector.handle(revision({}, [entry]));
	assert.equal(records.length, 0);
});

test("the queue drains every revision unfolded, in order", async () => {
	const records = [];
	const queue = new RevisionQueue(projectorOf(records));
	const live = (text) => ({ "pi.live": { run: { taskId: "t", inputs: [], turns: 0 }, generation: { attempt: 0, message: { role: "assistant", content: [{ type: "text", text }] } } } });
	queue.push(revision(live("a")));
	queue.push(revision(live("ab")));
	await queue.idle();
	const deltas = records
		.filter((record) => record.type === "message_update" && record.assistantMessageEvent.type === "text_delta")
		.map((record) => record.assistantMessageEvent.delta);
	assert.deepEqual(deltas, ["a", "b"]);
});
