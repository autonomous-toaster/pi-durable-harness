import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeJsonl, readJsonl } from "../dist/rpc/framing.js";

async function* chunks(...values) {
	for (const value of values) yield value;
}

async function collect(source) {
	const out = [];
	for await (const line of readJsonl(source)) out.push(line);
	return out;
}

test("splits records on LF only and strips CR", async () => {
	const lines = await collect(chunks('{"a":1}\r\n', '{"b":2}\n'));
	assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("Unicode line separators inside strings do not split a record", async () => {
	const payload = JSON.stringify({ type: "message_update", delta: "a\u2028b\u2029c" });
	const lines = await collect(chunks(payload.slice(0, 10), payload.slice(10), "\n"));
	assert.equal(lines.length, 1);
	assert.equal(JSON.parse(lines[0]).delta, "a\u2028b\u2029c");
});

test("records split across chunks are buffered", async () => {
	const lines = await collect(chunks('{"x"', ':1}', "\n"));
	assert.deepEqual(lines, ['{"x":1}']);
});

test("a trailing record without LF is not emitted", async () => {
	const lines = await collect(chunks('{"x":1}'));
	assert.deepEqual(lines, []);
});

test("encodeJsonl terminates with exactly one LF", () => {
	assert.equal(encodeJsonl({ type: "agent_start" }), '{"type":"agent_start"}\n');
});
