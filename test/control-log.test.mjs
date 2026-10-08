import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { Harness, MemoryStorage, createRegistry } from "@earendil-works/pi-durable";
import { ControlEntry, PolicyEntry, projectEntry } from "../dist/harness/projection.js";
import { shellEnvironment } from "../dist/rpc/session.js";

const context = BACKGROUND_CONTEXT;

async function openHarness() {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const harness = await Harness.open(new MemoryStorage(), { models, registry: createRegistry() }, context);
	const root = await harness.root(context);
	return { harness, root };
}

test("control-plane transitions are durable and project at their position", async () => {
	const { harness, root } = await openHarness();
	try {
		await root.commit(
			(tx) => tx.appendEntry(ControlEntry, root.id, { data: { type: "model_change", provider: "openai", modelId: "gpt" } }),
			context,
		);
		const page = await root.entries({ order: "ascending" }, 64, undefined, context);
		const control = page.items.find((record) => record.kind === "harness.control");
		assert.ok(control, "control entry was committed");
		const projected = projectEntry(control, null);
		assert.equal(projected.type, "model_change");
		assert.equal(projected.provider, "openai");
	} finally {
		await harness.close(context);
	}
});

test("run policy is stored durably and the latest wins", async () => {
	const { harness, root } = await openHarness();
	try {
		await root.commit((tx) => tx.appendEntry(PolicyEntry, root.id, { data: { steeringMode: "all" } }), context);
		await root.commit((tx) => tx.appendEntry(PolicyEntry, root.id, { data: { steeringMode: "one-at-a-time" } }), context);
		const page = await root.entries({ order: "ascending" }, 64, undefined, context);
		const latest = page.items.findLast((record) => record.kind === "harness.policy");
		assert.equal(latest.data.steeringMode, "one-at-a-time");
	} finally {
		await harness.close(context);
	}
});

test("shell commands receive pi session metadata", () => {
	const env = shellEnvironment({ model: { provider: "openai", modelId: "gpt" }, thinkingLevel: "high" }, "kobo-7");
	assert.equal(env.PI_SESSION_ID, "kobo-7");
	assert.equal(env.PI_PROVIDER, "openai");
	assert.equal(env.PI_MODEL, "gpt");
	assert.equal(env.PI_REASONING_LEVEL, "high");
	assert.equal(env.AI_AGENT, "pi");
	assert.equal(env.PI_CODING_AGENT, "true");
});
