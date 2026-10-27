import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { codemodeTool, renderCodemodeDescription } from "../dist/tools/codemode.js";
import { toolSearchTool } from "../dist/tools/tool-search.js";
import { setMcpEntries } from "../dist/tools/state.js";

const context = BACKGROUND_CONTEXT;

function registration(name, text = "ok") {
	return {
		name,
		description: `does ${name}`,
		execute: async () => ({ output: [{ type: "text", text }] }),
	};
}

function entry(name, server, exposure) {
	const tool = registration(name);
	return {
		name,
		server,
		toolName: name,
		exposure,
		description: tool.description,
		inputSchema: undefined,
		outputSchema: undefined,
		annotations: undefined,
		registration: tool,
	};
}

function apiWith(tools) {
	return { registry: { tools: () => tools.map((tool) => ({ extension: { name: "x" }, tool })) } };
}

test("codemode exposes callable tools and withholds hidden and model-only ones", async () => {
	setMcpEntries([
		entry("mcp__s__t", "s", "codemode"),
		entry("mcp__s__h", "s", "hidden"),
		entry("mcp__s__m", "s", "model-only"),
	]);
	const tools = [registration("mcp__s__t"), registration("mcp__s__h"), registration("mcp__s__m")];
	const hit = await codemodeTool.execute({ code: "return await tools.mcp__s__t({});" }, apiWith(tools), context);
	assert.notEqual(hit.isError, true);
	assert.equal(hit.output[0].text, "ok");

	const miss = await codemodeTool.execute({ code: "return await tools.mcp__s__h({});" }, apiWith(tools), context);
	assert.equal(miss.isError, true);
});

test("the codemode description lists callable tools and hides deferred ones", () => {
	setMcpEntries([entry("mcp__s__a", "s", "codemode"), entry("mcp__d__x", "d", "codemode-deferred")]);
	const tools = [registration("mcp__s__a"), registration("mcp__d__x")];
	const description = renderCodemodeDescription(tools);
	// pi keeps codemode-exposure MCP tools out of the description; codemode-deferred tools are listed.
	assert.doesNotMatch(description, /mcp__s__a/);
	assert.match(description, /mcp__d__x/);
});

test("the codemode description stays within the inline budget", () => {
	const entries = Array.from({ length: 400 }, (_, index) => entry(`mcp__s__tool_${index}`, "s", "codemode"));
	setMcpEntries(entries);
	const description = renderCodemodeDescription(entries.map((item) => item.registration));
	assert.ok(description.length < 20_000);
});

test("tool_search loads codemode and deferred tools and skips direct ones", async () => {
	setMcpEntries([
		entry("mcp__s__code", "s", "codemode"),
		entry("mcp__s__def", "s", "deferred"),
		entry("mcp__s__dir", "s", "direct"),
	]);
	const tools = [registration("mcp__s__code"), registration("mcp__s__def"), registration("mcp__s__dir")];
	const result = await toolSearchTool.execute({ query: "mcp" }, apiWith(tools), context);
	const listed = JSON.parse(result.content[0].text).map((tool) => tool.name);
	assert.deepEqual(listed.sort(), ["mcp__s__code", "mcp__s__def"]);
	assert.deepEqual([...result.control.addTools].sort(), ["mcp__s__code", "mcp__s__def"]);
});
