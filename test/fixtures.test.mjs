import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = join(root, "test", "fixtures");

async function latestFixtureDir() {
	const dirs = (await readdir(fixturesRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() && entry.name.startsWith("pi-"))
		.map((entry) => entry.name)
		.sort();
	return join(fixturesRoot, dirs.at(-1));
}

async function readRecords(file) {
	const text = await readFile(file, "utf8");
	return text
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line));
}

test("every fixture record is one LF-terminated JSON object", async () => {
	const dir = await latestFixtureDir();
	for (const name of await readdir(dir)) {
		if (!name.endsWith(".ndjson")) continue;
		const text = await readFile(join(dir, name), "utf8");
		assert.ok(text.endsWith("\n"), `${name} ends with LF`);
		assert.ok(!text.includes("\r"), `${name} has no carriage returns`);
		for (const line of text.split("\n").slice(0, -1)) JSON.parse(line);
	}
});

test("read commands return successful responses with the requested id", async () => {
	const dir = await latestFixtureDir();
	const records = await readRecords(join(dir, "read-commands.ndjson"));
	const responses = records.filter((record) => record.type === "response");
	assert.equal(responses.length, 9);
	for (const response of responses) {
		assert.equal(response.success, true, `${response.command} succeeds`);
		assert.equal(typeof response.id, "string");
		assert.equal(typeof response.command, "string");
		assert.ok(response.data !== undefined, `${response.command} carries data`);
	}
	const state = responses.find((r) => r.command === "get_state");
	assert.equal(typeof state.data.sessionId, "string");
});

test("error behaviors match the pinned pi", async () => {
	const dir = await latestFixtureDir();
	const records = await readRecords(join(dir, "errors.ndjson"));
	assert.equal(records.length, 3);

	// pi answers malformed JSON without a command id or request id.
	assert.equal(records[0].type, "response");
	assert.equal(records[0].success, false);
	assert.equal(records[0].id, undefined);
	assert.equal(records[0].command, undefined);

	assert.equal(records[1].id, "e2");
	assert.equal(records[1].success, false);
	assert.match(records[1].error, /Unknown command/);

	assert.equal(records[2].id, "e3");
	assert.equal(records[2].command, "set_model");
	assert.equal(records[2].success, false);
	assert.match(records[2].error, /Model not found/);
});
