/**
 * `--fork` copies a session into a new one (tasks: pi's fork flag).
 *
 * A session is a storage here, so the fork is the cross-storage copy durable
 * does not provide: entries replayed in order, head markers kept, and the
 * source's model carried over. SQLite files stand in for two sessions because a
 * Harness closes the storage it opens, and the copy reopens both.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { copySession } from "../dist/harness/fork.js";
import { resolveConfig } from "../dist/harness/config.js";

const context = BACKGROUND_CONTEXT;

/** A source session holding two message entries and a head marker. */
async function seeded(path, models) {
	const storage = await openNodeSqliteStorage(path);
	const harness = await Harness.open(storage, { models, registry: createRegistry() }, context);
	const conversation = await harness.root(context, {
		agent: { model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: "high" },
	});
	await conversation.commit(async (tx) => {
		await tx.appendEntry(conversation.id, { kind: "pi.user", model: [{ role: "user", content: "first" }] });
		await tx.appendEntry(conversation.id, { kind: "pi.assistant", model: [{ role: "assistant", content: "second" }] });
		await tx.appendEntry(conversation.id, { kind: "harness.control", data: { type: "session_info", name: "seeded" }, head: "self" });
	}, context);
	await harness.close(context);
}

test("--fork is parsed as a session id", () => {
	const config = resolveConfig(["--fork", "abc123"], {}, "/w");
	assert.equal(config.forkFrom, "abc123");
	assert.deepEqual(config.prompts, []);
});

test("a fork replays the transcript and the model", async () => {
	const dir = await mkdtemp(join(tmpdir(), "harness-fork-"));
	const models = createModels();
	models.setProvider(fauxProvider().provider);
	try {
		const sourcePath = join(dir, "source.sqlite");
		const targetPath = join(dir, "target.sqlite");
		await seeded(sourcePath, models);

		const source = await openNodeSqliteStorage(sourcePath);
		const target = await openNodeSqliteStorage(targetPath);
		const result = await copySession(source, target, models);
		assert.equal(result.entries, 3);
		assert.deepEqual(result.model, { provider: "faux", modelId: "faux-1" });

		const reopened = await openNodeSqliteStorage(targetPath);
		const harness = await Harness.open(reopened, { models, registry: createRegistry() }, context);
		try {
			const conversation = await harness.root(context);
			const entries = (await conversation.entries({ order: "ascending" }, 100, undefined, context)).items;
			assert.deepEqual(
				entries.map((entry) => entry.kind),
				["pi.user", "pi.assistant", "harness.control"],
			);
			assert.equal(entries[0].model[0].content, "first");
			// The head marker still starts a new active context at itself.
			assert.equal(entries[2].head, entries[2].id);
			const agent = await conversation.agent(context);
			assert.equal(agent.model?.modelId, "faux-1");
			assert.equal(agent.thinkingLevel, "high");
		} finally {
			await harness.close(context);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
