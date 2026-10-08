/**
 * MCP support (task 7.4): read `mcp.json`, connect each configured server with
 * `@earendil-works/pi-mcp`, and expose its tools as durable tools named
 * `mcp__<server>__<tool>`. Servers are connected before the Harness opens, so
 * the discovered tools are part of the registry the agent is offered.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpClient, StdioTransport, StreamableHttpTransport, type Tool as McpTool } from "@earendil-works/pi-mcp";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";

/** Map MCP content blocks to the model content blocks durable stores. */
function mapMcpContent(content: readonly unknown[]): unknown[] {
	const blocks: unknown[] = [];
	for (const block of content as readonly { type?: string; text?: string; data?: string; mimeType?: string }[]) {
		if (block.type === "text" && typeof block.text === "string") blocks.push({ type: "text", text: block.text });
		else if (block.type === "image" && block.data !== undefined && block.mimeType !== undefined)
			blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
		else blocks.push({ type: "text", text: JSON.stringify(block) });
	}
	return blocks;
}

export interface McpServerConfig {
	readonly command?: string;
	readonly args?: readonly string[];
	readonly env?: Record<string, string>;
	readonly url?: string;
	readonly headers?: Record<string, string>;
	readonly exposure?: string;
}

export interface McpConfig {
	readonly mcpServers?: Record<string, McpServerConfig>;
	readonly exposure?: string;
}

async function readJson(path: string): Promise<McpConfig | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as McpConfig;
	} catch {
		return undefined;
	}
}

/** Merge the global and project `mcp.json`; the project entry wins. */
export async function loadMcpConfig(agentDir: string, cwd: string): Promise<McpConfig> {
	const global = (await readJson(join(agentDir, "mcp.json"))) ?? {};
	const project = (await readJson(join(cwd, ".pi", "mcp.json"))) ?? {};
	return {
		...(global.exposure === undefined ? {} : { exposure: global.exposure }),
		mcpServers: { ...global.mcpServers, ...project.mcpServers },
	};
}

/** One durable tool per MCP tool; the call goes through the connected client. */
export function createMcpTool(server: string, client: McpClient, tool: McpTool): ToolRegistration {
	return defineTool({
		name: `mcp__${server}__${tool.name}`,
		description: tool.description ?? `MCP tool ${tool.name} on ${server}`,
		parameters: (tool.inputSchema ?? { type: "object" }) as never,
			execute: async (args) => {
			const result = await client.request<{ content?: unknown[]; isError?: boolean }>("tools/call", {
				name: tool.name,
				arguments: args,
			});
			const content = mapMcpContent(result.content ?? []) as never;
			return { content, isError: result.isError === true };
		},
	});
}

export interface LoadedMcp {
	readonly tools: readonly ToolRegistration[];
	close(): Promise<void>;
}

/** Connect every configured server and collect its tools. A failing server is skipped. */
export async function loadMcpTools(agentDir: string, cwd: string): Promise<LoadedMcp> {
	const config = await loadMcpConfig(agentDir, cwd);
	const clients: McpClient[] = [];
	const tools: ToolRegistration[] = [];
	for (const [server, serverConfig] of Object.entries(config.mcpServers ?? {})) {
		const client = new McpClient({ name: "durable-rpc-harness", version: "0.0.0" });
		try {
			if (serverConfig.command !== undefined) {
				await client.connect(
					new StdioTransport({
						command: serverConfig.command,
						...(serverConfig.args === undefined ? {} : { args: serverConfig.args }),
						cwd,
						inheritEnv: true,
						...(serverConfig.env === undefined ? {} : { env: serverConfig.env }),
					}),
				);
			} else if (serverConfig.url !== undefined) {
				await client.connect(
					new StreamableHttpTransport({
						url: serverConfig.url,
						...(serverConfig.headers === undefined ? {} : { headers: serverConfig.headers }),
					}),
				);
			} else {
				continue;
			}
			const listed = await client.request<{ tools?: McpTool[] }>("tools/list");
			for (const tool of listed.tools ?? []) tools.push(createMcpTool(server, client, tool));
			clients.push(client);
		} catch (error) {
			process.stderr.write(`durable-rpc: MCP server ${server} failed: ${String(error)}\n`);
		}
	}
	return {
		tools,
		close: async () => {
			for (const client of clients) await client.close().catch(() => {});
		},
	};
}
