#!/usr/bin/env node
// A tiny stdio MCP server for the differential harness: three tools with
// distinct exposures (chosen by the caller's toolExposure) and one resource.
const TOOLS = [
	{ name: "code_tool", description: "A codemode tool", inputSchema: { type: "object", properties: { a: { type: "string" } } } },
	{ name: "defer_tool", description: "A deferred tool", inputSchema: { type: "object", properties: { b: { type: "number" } } } },
	{ name: "direct_tool", description: "A direct tool", inputSchema: { type: "object", properties: {} } },
];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk.toString("utf8");
	let at;
	while ((at = buffer.indexOf("\n")) !== -1) {
		const line = buffer.slice(0, at);
		buffer = buffer.slice(at + 1);
		if (line.length === 0) continue;
		const message = JSON.parse(line);
		const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
		if (message.method === "initialize") {
			reply({
				protocolVersion: "2025-06-18",
				capabilities: { tools: {}, resources: {} },
				serverInfo: { name: "fake", version: "1" },
			});
		} else if (message.method === "tools/list") {
			reply({ tools: TOOLS });
		} else if (message.method === "resources/list") {
			reply({ resources: [{ uri: "file:///fake/resource", name: "resource", mimeType: "text/plain" }] });
		} else if (message.method === "tools/call") {
			reply({ content: [{ type: "text", text: `${message.params.name} ran` }] });
		} else if (message.method === "resources/read") {
			reply({ contents: [{ uri: message.params.uri, text: "resource body" }] });
		} else if (message.id !== undefined) {
			send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `no such method: ${message.method}` } });
		}
	}
});
