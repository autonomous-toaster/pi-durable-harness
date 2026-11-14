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

// read-economy-2: the safety net waits for silence, and nothing else re-reads the branch.

const { PROBE_SILENCE_MS, shouldProbe } = await import("../dist/harness/read-plan.js");

test("no probe while revisions keep arriving", () => {
	const now = 1_000_000;
	for (let step = 0; step < 60; step++) {
		const at = now + step * 5_000;
		assert.equal(shouldProbe({ now: at, lastRevisionAt: at - 2_000, lastProbeAt: 0 }), false, `step ${step}`);
	}
});

test("one probe per silence window, and no more", () => {
	const start = 1_000_000;
	const first = start + PROBE_SILENCE_MS;
	assert.equal(shouldProbe({ now: first, lastRevisionAt: start, lastProbeAt: 0 }), true);
	// A second tick inside the window is refused: the probe already ran.
	assert.equal(shouldProbe({ now: first + 1_000, lastRevisionAt: start, lastProbeAt: first }), false);
	assert.equal(shouldProbe({ now: first + PROBE_SILENCE_MS, lastRevisionAt: start, lastProbeAt: first }), true);
});

test("sixty idle seconds cost at most three probes", () => {
	const start = 1_000_000;
	let lastProbe = 0;
	let probes = 0;
	for (let second = 0; second <= 60; second++) {
		const now = start + second * 1_000;
		if (!shouldProbe({ now, lastRevisionAt: start, lastProbeAt: lastProbe })) continue;
		lastProbe = now;
		probes += 1;
	}
	assert.ok(probes <= 3, `probes: ${probes}`);
	assert.equal(probes, 2);
});

test("a PostgreSQL session defers partial progress; a local one does not", async () => {
	const { resolveConfig } = await import("../dist/harness/config.js");
	const pg = resolveConfig([], { PI_DURABLE_PGHOST: "127.0.0.1" }, "/tmp", false);
	assert.equal(pg.persistWithinMs, 500);
	const explicit = resolveConfig([], { PI_DURABLE_PGHOST: "127.0.0.1", PI_DURABLE_PERSIST_WITHIN_MS: "0" }, "/tmp", false);
	assert.equal(explicit.persistWithinMs, 0);
	const local = resolveConfig([], {}, "/tmp", false);
	assert.equal(local.persistWithinMs, 0);
});

test("an extension event assembles its snapshot without reading", async () => {
	const { refreshSnapshot, emptySnapshot } = await import("../dist/extensions/actions.js");
	const entries = [
		{ id: 1, kind: "pi.user", model: [{ role: "user", content: "hello" }] },
		{ id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: "hi" }] },
	];
	let reads = 0;
	const engine = {
		get knownEntries() {
			return entries;
		},
		get messagesKnown() {
			return entries.map((entry) => entry.model[0]);
		},
		entries: async () => {
			reads += 1;
			return entries;
		},
		messages: async () => {
			reads += 1;
			return [];
		},
	};
	const snapshot = emptySnapshot();
	await refreshSnapshot(engine, snapshot);
	assert.equal(reads, 0);
	assert.equal(snapshot.entries.length, 2);
	assert.equal(snapshot.messages.length, 2);
});
