import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLayout, policies, scopeIndex, scopeRoleSetup, scopeTable, stripPrefix } from "../dist/storage/postgres/layout.js";

// Durable's prefix carries its own trailing underscore; names are `<prefix><table>`.
const prefix = "s_1a2b3c4d5e6f_";
const shared = { prefix };

test("the prefix is dropped from a table name", () => {
	assert.equal(stripPrefix(prefix, "SELECT * FROM s_1a2b3c4d5e6f_entries"), "SELECT * FROM entries");
	// A prefix without the separator still yields the bare table name.
	assert.equal(stripPrefix("s_abc", "SELECT * FROM s_abc_entries"), "SELECT * FROM entries");
});

test("a created table carries the session and keys on it", () => {
	const inline = scopeTable({ name: "record_ids", body: " id BIGINT PRIMARY KEY, record_type TEXT NOT NULL" });
	assert.match(inline, /session TEXT NOT NULL DEFAULT current_setting\('app\.session', true\)/);
	assert.match(inline, /id BIGINT/);
	assert.match(inline, /PRIMARY KEY \(session, id\)/);
	assert.match(inline, /CREATE TABLE IF NOT EXISTS/);

	// A key written at table level is extended, not left behind.
	const table = scopeTable({ name: "document_revisions", body: " document_id BIGINT, seq BIGINT, PRIMARY KEY (document_id, seq)" });
	assert.match(table, /PRIMARY KEY \(session, document_id, seq\)/);
	assert.doesNotMatch(table, /PRIMARY KEY \(document_id/);
});

test("an index is scoped by session and created once", () => {
	const scoped = scopeIndex("CREATE INDEX s_1a2b3c4d5e6f_entries_by_conversation ON s_1a2b3c4d5e6f_entries (conversation_id, id DESC)");
	assert.match(scoped, /CREATE INDEX IF NOT EXISTS/);
	assert.match(scoped, /\(session, conversation_id, id DESC\)/);
});

test("an upsert names the session, since every key now starts with it", async () => {
	const applied = await applyLayout(
		"INSERT INTO s_1a2b3c4d5e6f_durable_metadata (singleton, next_id) VALUES ($1, $2) ON CONFLICT (singleton) DO UPDATE SET next_id = 1",
		shared,
	);
	assert.match(applied.sql, /ON CONFLICT \(session, singleton\)/);
});

test("a created table gets the session policy, in the order that works", async () => {
	const applied = await applyLayout("CREATE TABLE s_1a2b3c4d5e6f_entries ( id BIGINT PRIMARY KEY )", shared);
	assert.match(applied.sql, /^CREATE TABLE IF NOT EXISTS entries/);
	assert.deepEqual(applied.after, policies("entries"));
	// FORCE, so the owner of the table is scoped too.
	assert.ok(applied.after.includes("ALTER TABLE entries FORCE ROW LEVEL SECURITY"));
});

test("the scope role is created, granted, and assumed", () => {
	const setup = scopeRoleSetup("durable");
	assert.match(setup[0], /CREATE ROLE durable_scope NOLOGIN/);
	assert.ok(setup.some((sql) => /GRANT USAGE, CREATE ON SCHEMA "durable"/.test(sql)));
	assert.ok(setup.some((sql) => /GRANT durable_scope TO CURRENT_USER/.test(sql)));
	// Last, so the migrations that follow create tables this role owns.
	assert.equal(setup.at(-1), "SET ROLE durable_scope");
});

test("the storage layer takes no option to bypass the writer lock", async () => {
	const { readFileSync } = await import("node:fs");
	// One writer per storage is durable's rule, so no flag, option, or env var may
	// offer to break it. Checked at the source, since the flag is simply gone.
	const storage = readFileSync(new URL("../src/storage/postgres/storage.ts", import.meta.url), "utf8");
	assert.doesNotMatch(storage, /takeOver/);
	assert.match(storage, /throw new SessionLockedError/);
});

test("the backend declares the references the portable core cannot", async () => {
	const { addForeignKeys, dropForeignKeys } = await import("../dist/storage/postgres/layout.js");
	const added = addForeignKeys();
	assert.equal(added.length, 6);
	// Every one is deferred: durable writes a conversation before the task that owns it,
	// and rebuilds tables by dropping them, so checks belong at commit.
	for (const sql of added) assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
	assert.ok(added.some((sql) => /entries_conversation_fk/.test(sql) && /\(session, conversation_id\) REFERENCES conversations \(session, id\)/.test(sql)));
	// The one child that is replaced wholesale carries its document with it.
	assert.ok(added.some((sql) => /document_revisions_document_fk/.test(sql) && /ON DELETE CASCADE/.test(sql)));
	// They are removed before a migration, since version 2 drops and renames tasks.
	assert.equal(dropForeignKeys().length, 6);
	for (const sql of dropForeignKeys()) assert.match(sql, /DROP CONSTRAINT/);
});
