import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { resolvePrompts, runOneShot } from "../dist/harness/oneshot.js";

function output() {
	const out = new PassThrough();
	let text = "";
	out.on("data", (chunk) => (text += chunk.toString("utf8")));
	return { out, text: () => text };
}

function events() {
	return {
		snapshot: {},
		start(listener) {
			void listener([
				{ type: "run_start", inputs: [] },
				{ type: "run_end", inputs: [] },
			]);
		},
		stop: async () => ({ reason: "stopped" }),
		closed: Promise.resolve({ reason: "stopped" }),
	};
}

const base = (out, overrides = {}) => ({
	submitAndWait: async () => true,
	lastAssistantText: async () => undefined,
	watchEvents: async () => events(),
	isQuiescent: async () => true,
	sessionId: "s",
	cwd: "/work",
	out,
	...overrides,
});

test("print mode writes the final assistant text", async () => {
	const { out, text } = output();
	const code = await runOneShot("print", ["hi"], base(out, { lastAssistantText: async () => "hello" }));
	assert.equal(code, 0);
	assert.equal(text(), "hello\n");
});

test("json mode writes a session header and the events", async () => {
	const { out, text } = output();
	const code = await runOneShot("json", ["hi"], base(out));
	assert.equal(code, 0);
	const lines = text()
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.equal(lines[0].type, "session");
	assert.equal(lines[0].version, 3);
	assert.equal(lines[0].id, "s");
	assert.ok(lines.some((line) => line.type === "agent_start"));
});

test("an unanswered prompt exits non-zero", async () => {
	const { out } = output();
	const code = await runOneShot("print", ["hi"], base(out, { submitAndWait: async () => false }));
	assert.equal(code, 1);
});

test("resolvePrompts inlines a text file and prepends piped stdin", async () => {
	const dir = await mkdtemp(join(tmpdir(), "oneshot-"));
	try {
		const file = join(dir, "note.txt");
		await writeFile(file, "file body");
		const { texts, images } = await resolvePrompts([`@${file}`, "second"], "stdin body");
		assert.equal(texts[0], "stdin body\nfile body");
		assert.equal(texts[1], "second");
		assert.deepEqual(images, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
