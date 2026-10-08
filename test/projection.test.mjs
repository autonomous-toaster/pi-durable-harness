import assert from "node:assert/strict";
import { test } from "node:test";
import { projectEntries, projectEntry, renderTranscriptHtml } from "../dist/harness/projection.js";
import { toUserContent } from "../dist/harness/input.js";

const entry = (id, kind, extra = {}) => ({ id, conversationId: 1, kind, ...extra });

test("projects durable message entries to pi message entries", () => {
	const projected = projectEntry(entry(2, "pi.assistant", { model: [{ role: "assistant", content: "hi" }] }), "1");
	assert.equal(projected.type, "message");
	assert.equal(projected.id, "2");
	assert.equal(projected.parentId, "1");
	assert.equal(projected.message.role, "assistant");
});

test("projects control-plane transitions at their position", () => {
	const projected = projectEntry(entry(3, "harness.control", { data: { type: "model_change", provider: "openai", modelId: "gpt" } }), "2");
	assert.equal(projected.type, "model_change");
	assert.equal(projected.provider, "openai");
	assert.equal(projected.id, "3");
});

test("preserves unknown entry kinds verbatim", () => {
	const projected = projectEntry(entry(4, "future.kind", { data: { future: true } }), "3");
	assert.equal(projected.type, "custom");
	assert.equal(projected.customType, "future.kind");
	assert.deepEqual(projected.data, { future: true });
});

test("chains parent ids in an export", () => {
	const { entries, leafId } = projectEntries([entry(1, "pi.user", { model: [{ role: "user", content: "hi" }] }), entry(2, "pi.assistant")]);
	assert.equal(entries[0].parentId, null);
	assert.equal(entries[1].parentId, "1");
	assert.equal(leafId, "2");
});

test("renders messages, tool calls, and results as HTML", () => {
	const html = renderTranscriptHtml([
		entry(1, "pi.assistant", {
			model: [{ role: "assistant", content: [{ type: "text", text: "checking" }, { type: "toolCall", name: "bash", arguments: { command: "ls" } }] }],
		}),
		entry(2, "pi.tool-result", { model: [{ role: "toolResult", content: [{ type: "text", text: "file.txt" }] }] }),
	]);
	assert.match(html, /checking/);
	assert.match(html, /bash/);
	assert.match(html, /file\.txt/);
});

test("maps images to durable content blocks", () => {
	assert.equal(toUserContent("hi", undefined), "hi");
	assert.equal(toUserContent("hi", []), "hi");
	const content = toUserContent("hi", [{ type: "image", data: "AAAA", mimeType: "image/png" }]);
	assert.deepEqual(content, [
		{ type: "text", text: "hi" },
		{ type: "image", data: "AAAA", mimeType: "image/png" },
	]);
});
