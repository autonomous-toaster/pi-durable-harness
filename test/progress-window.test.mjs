/**
 * Progress-window behaviour against a live streaming model (tasks 6.3, 6.4).
 *
 * Durable defers a progress commit that changes only `pi.live` until the next
 * commit that reads the document, or `settings.progress.persistWithinMs`. This
 * test drives a real streaming model and counts publications that carry a
 * partial answer while the run is still active:
 *
 *   window 0      -> at least one: each partial is stored as it arrives
 *   large window  -> none: partials are folded into the commit that ends the run
 *
 * Opt-in, because it calls a real provider:
 *
 *   TEST_LIVE_MODEL=1 node --test test/progress-window.test.mjs
 *
 * Override the model with TEST_LIVE_PROVIDER / TEST_LIVE_MODEL_ID.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Harness, MemoryStorage, createRegistry } from "@earendil-works/pi-durable";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const context = BACKGROUND_CONTEXT;
const live = process.env.TEST_LIVE_MODEL === "1";
const provider = process.env.TEST_LIVE_PROVIDER ?? "ollama-cloud";
const modelId = process.env.TEST_LIVE_MODEL_ID ?? "deepseek-v4.1-flash:cloud";

/** Run one prompt and count partial-answer publications made while the run was active. */
async function partialsWhileRunning(persistWithinMs) {
	const models = await ModelRuntime.create();
	const harness = await Harness.open(
		new MemoryStorage(),
		{ models, registry: createRegistry(), settings: { progress: { persistWithinMs } } },
		context,
	);
	const conversation = await harness.root(context, { agent: { model: { provider, modelId } } });
	harness.resume();
	const publications = [];
	const observation = harness.observeCommits(
		{ advance: (publication) => publications.push(publication), end: () => {} },
		context,
	);
	try {
		const submission = await conversation.submit(
			{ type: "input", content: "Write the numbers 1 to 40, one per line, nothing else." },
			context,
		);
		await submission.wait(context);
		// Let a deferred commit flush on the next read/close before counting.
		await new Promise((resolve) => setTimeout(resolve, 1500));
	} finally {
		observation.detach();
		await harness.close(context);
	}
	const lives = publications
		.map((publication) =>
			publication.changes.find(
				(entry) => entry.type === "document" && entry.kind === "change" && entry.value !== undefined && "run" in entry.value,
			),
		)
		.filter((change) => change !== undefined);
	return {
		published: lives.length,
		partialWhileRunning: lives.filter((change) => change.value.run !== undefined && change.value.generation?.message !== undefined)
			.length,
	};
}

test(
	"an immediate window stores each partial as it arrives",
	{ skip: !live, timeout: 180_000 },
	async () => {
		const counts = await partialsWhileRunning(0);
		assert.ok(counts.published > 0, "the run published its live state");
		assert.ok(counts.partialWhileRunning >= 1, "a partial answer was stored while the run was active");
	},
);

test(
	"a deferred window folds the partial into the run end",
	{ skip: !live, timeout: 180_000 },
	async () => {
		const counts = await partialsWhileRunning(60_000);
		assert.ok(counts.published > 0, "the run published its live state");
		assert.equal(counts.partialWhileRunning, 0, "no partial answer was stored while the run was active");
	},
);
