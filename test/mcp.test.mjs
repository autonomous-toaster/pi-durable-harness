import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { McpClient } from "@earendil-works/pi-mcp";
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";
import { createMcpTool, loadMcpConfig } from "../dist/tools/mcp.js";

const context = BACKGROUND_CONTEXT;

/** A minimal MCP server over the in-memory transport. */
function fakeServer(server) {
	server.onMessage((message) => {
		const reply = (result) => server.send({ jsonrpc: "2.0", id: message.id, result });
		if (message.method === "initialize") {
			return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } });
		}
		if (message.method === "tools/list") {
			return reply({ tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] });
		}
		if (message.method === "tools/call") {
			return reply({ content: [{ type: "text", text: message.params.arguments.text }] });
		}
		return undefined;
	});
}

test("an MCP tool is exposed and calls the server", async () => {
	const pair = createInMemoryTransportPair();
	await pair.server.start();
	fakeServer(pair.server);
	const client = new McpClient({ name: "test", version: "0" });
	await client.connect(pair.client);
	try {
		const listed = await client.request("tools/list");
		const tool = createMcpTool("fake", client, listed.tools[0]);
		assert.equal(tool.name, "mcp__fake__echo");
		const result = await tool.execute({ text: "hi" }, {}, context);
		assert.equal(result.content[0].text, "hi");
		assert.notEqual(result.isError, true);
	} finally {
		await client.close();
	}
});

test("a missing mcp.json yields no servers", async () => {
	const config = await loadMcpConfig("/nonexistent-agent-dir", "/nonexistent-cwd");
	assert.deepEqual(config.mcpServers, {});
});
