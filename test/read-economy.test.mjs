/**
 * The read economy (tasks 1.1, 1.2, 2.1, 2.2, 3.1, 3.2).
 *
 * The rule: an idle poll asks one question and reads no record, a change reads the delta,
 * a branch that moved backwards is read whole, and a status answer costs no transcript
 * read. The decisions are pure functions, so sixty idle polls can be run in a test.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { advanceCursor, appendedMessages, lastAnswerOf, planRead, rewritesContext } = await import("../dist/harness/read-plan.js");

const cursor = (newestEntryId, entryCount = 10) => ({ newestEntryId, entryCount, messageCount: entryCount });

test("sixty idle polls read no record", () => {
	let held = cursor(42);
	let reads = 0;
	for (let poll = 0; poll < 60; poll++) {
		const plan = planRead(42, held);
		assert.equal(plan.kind, "none");
		if (plan.kind !== "none") reads += 1;
	}
	assert.equal(reads, 0);
});

test("a probe with nothing held reads the branch whole", () => {
	assert.equal(planRead(7, { entryCount: 0, messageCount: 0 }).kind, "full");
});

test("a probe above the held id reads the delta from that id", () => {
	const plan = planRead(50, cursor(42));
	assert.equal(plan.kind, "delta");
	assert.equal(plan.after, 42);
});

test("a branch below the held id is read whole", () => {
	assert.equal(planRead(9, cursor(42)).kind, "full");
});

test("a failed probe reads nothing, so it cannot become a transcript scan", () => {
	assert.equal(planRead(undefined, cursor(42)).kind, "none");
	assert.equal(planRead(undefined, { entryCount: 0, messageCount: 0 }).kind, "none");
});

test("the cursor follows a read", () => {
	const previous = { entryCount: 2, messageCount: 2, newestEntryId: 2 };
	const next = advanceCursor([{ id: 3, model: [{}] }, { id: 5, model: [{}] }, { id: 4 }], previous);
	assert.equal(next.newestEntryId, 5);
	assert.equal(next.entryCount, 5);
	assert.equal(next.messageCount, 4);
});

test("a delta appends its messages, and a compaction makes the branch be asked for", () => {
	const entries = [
		{ kind: "pi.user", model: [{ role: "user", content: "hi" }] },
		{ kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "hello" }] }] },
		{ kind: "harness.control", data: { type: "label" } },
	];
	assert.equal(rewritesContext(entries), false);
	assert.deepEqual(
		appendedMessages(entries).map((message) => message.role),
		["user", "assistant"],
	);
	assert.equal(rewritesContext([{ kind: "pi.compaction", data: { summary: "s" } }]), true);
});

test("the last answer comes from the messages already read", () => {
	assert.equal(lastAnswerOf([{ role: "user", content: "q" }, { role: "assistant", content: [{ type: "text", text: "a" }] }]), "a");
	assert.equal(lastAnswerOf([{ role: "user", content: "q" }]), undefined);
	assert.equal(lastAnswerOf([{ role: "assistant", content: [{ type: "toolCall" }] }]), undefined);
	assert.equal(lastAnswerOf([{ role: "assistant", content: "plain" }, { role: "user", content: "q" }]), "plain");
});
