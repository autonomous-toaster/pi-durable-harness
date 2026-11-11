import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { McpClient } from "@earendil-works/pi-mcp";
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpTool, loadMcpSettings, loadMcpTools } from "../dist/tools/mcp.js";

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
	const settings = await loadMcpSettings("/nonexistent-agent-dir", "/nonexistent-cwd");
	assert.deepEqual(settings.servers, []);
});

test("a server an extension registers joins the resolved set", async () => {
	const settings = await loadMcpSettings("/nonexistent-agent-dir", "/nonexistent-cwd", [
		{ name: "ext", config: { command: "node", args: ["server.mjs"] }, source: "/ext/index.js" },
	]);
	const server = settings.servers.find((entry) => entry.name === "ext");
	assert.ok(server, "the registered server is resolved");
	assert.equal(server.exposure, "codemode");
});

test("an extension registration shadows an mcp.json entry and says so", async () => {
	const dir = mkdtempSync(join(tmpdir(), "harness-mcp-"));
	try {
		writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "node", args: ["a.mjs"] } } }));
		const settings = await loadMcpSettings(dir, dir, [
			{ name: "shared", config: { command: "node", args: ["b.mjs"] }, source: "/ext/index.js" },
		]);
		assert.ok(settings.warnings.some((warning) => /shadows/.test(warning)), "the shadowing is reported");
		assert.deepEqual(settings.servers.find((entry) => entry.name === "shared").transport.args, ["b.mjs"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an extension server that cannot connect is named", async () => {
	const written = [];
	const original = process.stderr.write.bind(process.stderr);
	process.stderr.write = (chunk) => {
		written.push(String(chunk));
		return true;
	};
	let loaded;
	try {
		loaded = await loadMcpTools("/nonexistent-agent-dir", "/nonexistent-cwd", [
			{ name: "broken", config: { command: "/nonexistent-binary-for-test" }, source: "/ext/index.js" },
		]);
	} finally {
		process.stderr.write = original;
	}
	assert.equal(loaded.tools.length, 0);
	await loaded.close();
	assert.ok(written.some((line) => line.includes("broken")), "the server is named");
});
