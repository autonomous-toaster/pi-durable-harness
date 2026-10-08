import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createResourceTool } from "../dist/tools/mcp.js";
import { renderMcpServers } from "../dist/harness/prompt.js";
import { resolveMcpSettings } from "../dist/tools/exposure.js";

const context = BACKGROUND_CONTEXT;

test("a resource tool reads from the connected server", async () => {
	const clients = new Map([
		["s", { request: async (method, params) => (method === "resources/read" ? { contents: [{ uri: params.uri, text: "hello" }] } : {}) }],
	]);
	const tool = createResourceTool(clients);
	const result = await tool.execute({ server: "s", uri: "file:///a" }, {}, context);
	assert.equal(result.content[0].text, "hello");

	const missing = await tool.execute({ server: "nope", uri: "u" }, {}, context);
	assert.equal(missing.isError, true);
});

test("the mcp_servers text names codemode and deferred servers", () => {
	const servers = resolveMcpSettings({
		mcpServers: { a: { exposure: "codemode" }, b: { exposure: "deferred" }, c: { exposure: "direct" } },
	}).servers;
	const text = renderMcpServers(servers);
	assert.match(text, /- mcp__a \(codemode\)/);
	assert.match(text, /- mcp__b \(tool_search\)/);
	assert.doesNotMatch(text, /\bc:/);
});

test("the mcp_servers text is omitted without codemode or deferred servers", () => {
	const servers = resolveMcpSettings({ mcpServers: { c: { exposure: "direct" } } }).servers;
	assert.equal(renderMcpServers(servers), undefined);
});
