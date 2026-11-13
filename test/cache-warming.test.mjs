/**
 * Cache warming (tasks 3.1-3.6).
 *
 * The schedule and the economics are pi's `CacheWarmer`; what this harness owns is
 * what the warmer is given (the runtime durable calls, the branch, the usage sink),
 * when it is armed, and how a decision reaches an extension. A recording module
 * stands in for pi's, so each of those seams is asserted rather than assumed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { createCacheWarming } = await import("../dist/harness/warming.js");

/** pi's warmer, recorded: what it was given, and what was called on it. */
function fakeModule() {
	const calls = { start: [], settled: 0, modeChanged: 0, cancelled: 0 };
	class CacheWarmer {
		status = { state: "inactive", reason: "waiting for first request" };
		constructor(models, sessionManager, getMode, decide) {
			calls.models = models;
			calls.sessionManager = sessionManager;
			calls.getMode = getMode;
			calls.decide = decide;
		}
		start(request, isCurrent) {
			calls.start.push({ request, isCurrent });
		}
		onAgentSettled() {
			calls.settled += 1;
		}
		onModeChanged() {
			calls.modeChanged += 1;
		}
		cancel() {
			calls.cancelled += 1;
		}
	}
	return { calls, module: { CacheWarmer, formatCacheWarmingStatus: () => "Inactive (stub)" } };
}

const model = { provider: "p", id: "m" };

function runtime(spy) {
	return {
		streamSimple: (...args) => {
			spy.push(args);
			return { result: async () => ({ stopReason: "stop" }) };
		},
	};
}

test("the runtime durable is given arms warming with the request it sends", async () => {
	const { calls, module } = fakeModule();
	const sent = [];
	const warming = await createCacheWarming(
		{ models: runtime(sent), mode: () => "idle", branch: () => [], appendUsage: () => {} },
		async () => module,
	);

	const context = { messages: [{ role: "user", content: "hi" }] };
	warming.models.streamSimple(model, context, { sessionId: "s1" });

	assert.equal(calls.start.length, 1);
	assert.deepEqual(calls.start[0].request.model, model);
	assert.equal(calls.start[0].isCurrent(), true);
	// The request still reaches the runtime durable was given.
	assert.equal(sent.length, 1);
	assert.deepEqual(sent[0], [model, context, { sessionId: "s1" }]);
});

test("only the turn's own request re-arms warming", async () => {
	const { calls, module } = fakeModule();
	const warming = await createCacheWarming(
		{ models: runtime([]), mode: () => "idle", branch: () => [], appendUsage: () => {} },
		async () => module,
	);
	const context = { messages: [] };
	warming.models.streamSimple(model, context, { sessionId: "session" });
	// A compaction request in the same turn carries its own conversation id.
	warming.models.streamSimple(model, context, { sessionId: "compaction" });
	assert.equal(calls.start.length, 1);

	// The next turn adopts again, so a rewind or a fork starts warming afresh.
	warming.onSettled();
	warming.models.streamSimple(model, context, { sessionId: "forked" });
	assert.equal(calls.start.length, 2);
});

test("an entry stops being current when the branch no longer extends it", async () => {
	const { calls, module } = fakeModule();
	let branch = [
		{ type: "message", message: { role: "user", content: "hi" } },
		{ type: "message", message: { role: "assistant", usage: { input: 1, cacheRead: 0, cacheWrite: 0 } } },
	];
	const warming = await createCacheWarming(
		{ models: runtime([]), mode: () => "idle", branch: () => branch, appendUsage: () => {} },
		async () => module,
	);
	const context = { messages: [{ role: "user", content: "hi" }] };
	warming.models.streamSimple(model, context, { sessionId: "s" });
	assert.equal(calls.start[0].isCurrent(), true);

	// A rewind drops the message the entry was written from.
	branch = [];
	assert.equal(calls.start[0].isCurrent(), false);
});

test("the warmer is given the settings mode, the branch, and the usage sink", async () => {
	const { calls, module } = fakeModule();
	const branch = [{ type: "message", message: { role: "assistant", usage: {} } }];
	const recorded = [];
	const warming = await createCacheWarming(
		{ models: runtime([]), mode: () => "streaming", branch: () => branch, appendUsage: (usage) => recorded.push(usage) },
		async () => module,
	);

	assert.equal(calls.getMode(), "streaming");
	assert.equal(calls.sessionManager.getBranch(), branch);

	// A refresh records pi's usage entry through the sink the engine supplies.
	calls.sessionManager.appendUsage("cache_warm", "p", "m", { cost: { total: 0.002 } }, "extension override");
	assert.deepEqual(recorded, [{ provider: "p", model: "m", usage: { cost: { total: 0.002 } }, note: "extension override" }]);
	void warming;
});

test("an extension decision is applied, and pi's decision stands without one", async () => {
	const { calls, module } = fakeModule();
	const warming = await createCacheWarming(
		{ models: runtime([]), mode: () => "idle", branch: () => [], appendUsage: () => {} },
		async () => module,
	);
	const event = { type: "cache_warming_decision", action: "warm", warmCost: 0.001, missCost: 0.01 };
	assert.equal(await calls.decide(event), "warm");

	warming.setDecider(async () => "stop");
	assert.equal(await calls.decide(event), "stop");

	// A handler that throws leaves pi's own decision in place.
	warming.setDecider(async () => {
		throw new Error("handler failed");
	});
	assert.equal(await calls.decide(event), "warm");
});

test("closing the session cancels the run", async () => {
	const { calls, module } = fakeModule();
	const warming = await createCacheWarming(
		{ models: runtime([]), mode: () => "idle", branch: () => [], appendUsage: () => {} },
		async () => module,
	);
	warming.onModeChanged();
	warming.cancel();
	assert.equal(calls.modeChanged, 1);
	assert.equal(calls.cancelled, 1);
});

test("pi's own formatter renders the status the panel prints", async () => {
	const { loadCacheWarmerModule } = await import("../dist/harness/pi-internals.js");
	const { formatCacheWarmingStatus } = await loadCacheWarmerModule();
	assert.equal(formatCacheWarmingStatus({ state: "inactive", reason: "waiting for first request" }), "Inactive (waiting for first request)");
	assert.equal(formatCacheWarmingStatus({ state: "inactive", reason: "cache lifetime unavailable" }), "Inactive (cache lifetime unavailable)");
});

test("a recorded refresh projects as pi's usage entry", async () => {
	const { projectEntry } = await import("../dist/harness/projection.js");
	const usage = { input: 3, output: 1, cacheRead: 900, cacheWrite: 0, cost: { total: 0.0021 } };
	const projected = projectEntry(
		{
			id: 7,
			kind: "harness.control",
			data: { type: "cache_warm", provider: "p", model: "m", usage, note: "extension override" },
		},
		"6",
	);
	assert.deepEqual(projected, {
		id: "7",
		parentId: "6",
		type: "usage",
		kind: "cache_warm",
		provider: "p",
		model: "m",
		usage,
		note: "extension override",
	});
});
