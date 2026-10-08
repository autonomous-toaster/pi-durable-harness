import assert from "node:assert/strict";
import { test } from "node:test";
import { translatePlaceholders, translateStatement } from "../dist/storage/postgres/ddl.js";

test("placeholders become numbered parameters", () => {
	assert.equal(
		translatePlaceholders("SELECT record FROM entries WHERE conversation_id = ? AND id <= ? LIMIT ?"),
		"SELECT record FROM entries WHERE conversation_id = $1 AND id <= $2 LIMIT $3",
	);
});

test("question marks inside string literals are left alone", () => {
	assert.equal(
		translatePlaceholders("SELECT '?' AS marker, id FROM t WHERE id = ?"),
		"SELECT '?' AS marker, id FROM t WHERE id = $1",
	);
});

test("STRICT and json_valid are dropped for PostgreSQL", () => {
	const ddl = translateStatement(
		"CREATE TABLE documents (id INTEGER PRIMARY KEY, record TEXT NOT NULL CHECK (json_valid(record))) STRICT",
	);
	assert.equal(ddl, "CREATE TABLE documents (id BIGINT PRIMARY KEY, record TEXT NOT NULL )");
	assert.ok(!ddl.includes("INTEGER"));
	assert.ok(!ddl.includes("STRICT"));
	assert.ok(!ddl.includes("json_valid"));
});

test("INSERT OR IGNORE becomes ON CONFLICT DO NOTHING", () => {
	assert.equal(
		translateStatement("INSERT OR IGNORE INTO record_ids (id, record_type) VALUES (?, ?)"),
		"INSERT INTO record_ids (id, record_type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
	);
});
