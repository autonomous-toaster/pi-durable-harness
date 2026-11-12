/**
 * One schema, a prefix per session, a lock per prefix (tasks 3.1, 3.2).
 *
 * Two sessions in one directory must run at the same time, so two prefixes in
 * one schema both open; a second writer of the same prefix is refused.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { openPostgresStorage, SessionLockedError } from "../dist/storage/postgres/storage.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url === undefined;

test("two prefixes share one schema and one prefix is refused twice", { skip }, async () => {
	const schema = `harness_prefix_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
	const pool = new pg.Pool({ connectionString: url });
	const opened = [];
	try {
		const first = await openPostgresStorage({ pool, schema, prefix: "s_aaaa_" });
		opened.push(first);
		const second = await openPostgresStorage({ pool, schema, prefix: "s_bbbb_" });
		opened.push(second);
		assert.ok(first !== second);

		const again = openPostgresStorage({ pool, schema, prefix: "s_aaaa_" });
		await assert.rejects(again, (error) => error instanceof SessionLockedError);
	} finally {
		for (const storage of opened) await storage.close().catch(() => {});
		await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
		await pool.end();
	}
});
