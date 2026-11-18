/**
 * One committed state per document read (task 3.1).
 *
 * The test proves the property at the facade: a read inside a snapshot keeps seeing the state it
 * started with, even after another connection commits a row mid-read.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { testDatabase } from "./support-database.mjs";

const { url, skip } = testDatabase();

test("a snapshot read does not see a commit that lands mid-read", { skip }, async () => {
	const schema = `harness_snap_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
	const owner = new pg.Pool({ connectionString: url });
	// The scoped table carries a session column, so a second connection writes with the same scope.
	const writer = new pg.Pool({ connectionString: url, options: "-c app.session=s_snap_" });
	const { PostgresDatabase } = await import("../dist/storage/postgres/database.js");
	const database = await PostgresDatabase.open(owner, schema, { prefix: "s_snap_" });
	try {
		await database.exec("CREATE TABLE counter (value BIGINT)");
		await database.run("INSERT INTO counter (value) VALUES (?)", 1);

		const seen = await database.snapshot(async () => {
			const before = await database.get("SELECT count(*) AS n FROM counter");
			// A different connection commits while the snapshot is open.
			await writer.query(`INSERT INTO "${schema}".counter (value) VALUES (2)`);
			const after = await database.get("SELECT count(*) AS n FROM counter");
			return { before: Number(before.n), after: Number(after.n) };
		});

		assert.equal(seen.before, 1);
		assert.equal(seen.after, 1, "the second statement must observe the state the snapshot began with");
		// Outside the snapshot the commit is visible, so the test is not simply blind.
		const outside = await database.get("SELECT count(*) AS n FROM counter");
		assert.equal(Number(outside.n), 2);
	} finally {
		await database.close();
		await writer.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
		await writer.end();
		await owner.end().catch(() => {});
	}
});
