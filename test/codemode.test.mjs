import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { codemodeTool } from "../dist/tools/codemode.js";
import { toolSearchTool } from "../dist/tools/tool-search.js";

const context = BACKGROUND_CONTEXT;

function agentWith(tools) {
	return { agent: async () => ({ tools }) };
}

test("codemode composes tool calls in the sandbox", async () => {
	const double = {
		name: "double",
		description: "Double a number",
		execute: async (args) => ({ content: [{ type: "text", text: String(args.n * 2) }] }),
	};
	const result = await codemodeTool.execute({ code: "return await tools.double({ n: 21 });" }, agentWith([double]), context);
	assert.notEqual(result.isError, true);
	assert.equal(result.content[0].text, "42");
});

test("codemode reports a script error without throwing", async () => {
	const result = await codemodeTool.execute({ code: "throw new Error('boom');" }, agentWith([]), context);
	assert.equal(result.isError, true);
	assert.match(result.content[0].text, /boom/);
});

test("tool_search finds tools by name or description", async () => {
	const tools = [
		{ name: "ls", description: "List directory contents" },
		{ name: "grep", description: "Search file contents for patterns" },
	];
	const byDescription = await toolSearchTool.execute({ query: "search" }, agentWith(tools), context);
	assert.deepEqual(JSON.parse(byDescription.content[0].text).map((tool) => tool.name), ["grep"]);
	const byName = await toolSearchTool.execute({ query: "ls" }, agentWith(tools), context);
	assert.deepEqual(JSON.parse(byName.content[0].text).map((tool) => tool.name), ["ls"]);
});
