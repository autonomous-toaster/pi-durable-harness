import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { MemoryStorage, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import pg from "pg";
import { openPostgresStorage } from "../dist/storage/postgres/storage.js";

const url = process.env.TEST_DATABASE_URL;
const context = BACKGROUND_CONTEXT;

/** A canonical script that exercises identity, commit, and scan. */
async function observe(storage) {
	const root = ROOT_CONVERSATION_ID;
	const entryId = await storage.mintId();
	await storage.commit([{ type: "conversation", value: { id: root } }], context);
	await storage.commit(
		[
			{
				type: "entry",
				value: { id: entryId, conversationId: root, kind: "message", model: [{ role: "user", content: "hi" }] },
			},
		],
		context,
	);
	const conversations = await storage.scanConversations({}, 10, undefined, context);
	const entries = await storage.scanEntries({ conversationId: root, order: "ascending" }, 10, undefined, context);
	return {
		conversationIds: conversations.items.map((record) => record.id),
		entryKinds: entries.items.map((record) => record.kind),
		firstEntryId: entries.items[0]?.id,
	};
}

test("storage selection is invisible to the client", { skip: url === undefined }, async () => {
	const schema = `harness_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
	const pool = new pg.Pool({ connectionString: url });
	const memory = new MemoryStorage();
	const postgres = await openPostgresStorage({ pool, schema });
	try {
		const fromMemory = await observe(memory);
		const fromPostgres = await observe(postgres);
		assert.deepEqual(fromPostgres, fromMemory);
	} finally {
		await memory.close(context);
		await postgres.close(context);
		await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		await pool.end();
	}
});
