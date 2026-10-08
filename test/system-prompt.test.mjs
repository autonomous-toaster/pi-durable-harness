import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSystemPromptSections } from "../dist/harness/system-prompt.js";
import { TOOL_CONTRIBUTIONS } from "../dist/harness/prompt.js";

/** pi's builder, imported by file path because the package `exports` map hides it. */
const pi = await import(
	pathToFileURL(join(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js")).href
);

const toolSnippets = Object.fromEntries(Object.entries(TOOL_CONTRIBUTIONS).map(([name, c]) => [name, c.snippet]));
const toolGuidelines = Object.fromEntries(Object.entries(TOOL_CONTRIBUTIONS).map(([name, c]) => [name, [...c.guidelines]]));

const inputs = [
	{ selectedTools: ["read", "bash", "edit", "write"], cwd: "/work" },
	{ selectedTools: ["read", "bash", "ls", "grep", "find"], cwd: "/work/repo" },
	{
		selectedTools: ["read", "bash"],
		cwd: "C:\\repo",
		contextFiles: [{ path: "/repo/AGENTS.md", content: "Be careful." }],
		appendSystemPrompt: "Extra rules.",
		sections: { mcp_servers: "s: use codemode." },
	},
];

test("the ported builder matches pi's section builder", () => {
	for (const input of inputs) {
		const ours = buildSystemPromptSections({ ...input, toolSnippets, toolGuidelines });
		const theirs = pi.buildSystemPromptSections({ ...input, toolSnippets, toolGuidelines });
		assert.deepEqual(ours, theirs);
	}
});

test("the prompt sections reflect the declared tools", () => {
	const sections = buildSystemPromptSections({ selectedTools: ["read", "bash"], cwd: "/work", toolSnippets, toolGuidelines });
	assert.match(sections.preamble, /expert coding assistant/);
	assert.match(sections.tools, /- read: Read file contents/);
	assert.match(sections.rules, /- Be concise in your responses/);
	assert.equal(sections.cwd, "<cwd>\n/work\n</cwd>");
	assert.equal(sections.mcp_servers, undefined);
});
