/**
 * MCP support (tasks 1.3, 5.1): read `mcp.json`, connect each enabled server,
 * classify every tool by its exposure, and expose MCP resources. All tools are
 * installed in the registry; the declared set is computed from the exposure
 * table by the engine.
 */
import { McpClient, StdioTransport, StreamableHttpTransport, type Tool as McpTool } from "@earendil-works/pi-mcp";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { loadMcpSettings, resolveToolExposure, type McpSettings, type ResolvedServer, type ToolExposure } from "./exposure.js";

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

/** One discovered MCP tool with its exposure classification. */
export interface McpToolEntry {
	readonly name: string;
	readonly server: string;
	readonly toolName: string;
	readonly exposure: ToolExposure;
	readonly description: string;
	readonly inputSchema: unknown;
	readonly outputSchema: unknown;
	readonly annotations: unknown;
	readonly registration: ToolRegistration;
}

/** The exact tool name pi uses: `mcp__<server>__<tool>`. */
export function mcpToolName(server: string, toolName: string): string {
	return `mcp__${server}__${toolName}`;
}

/** One durable tool per MCP tool; the call goes through the connected client. */
export function createMcpTool(server: string, client: McpClient, tool: McpTool): ToolRegistration {
	const title = (tool as { title?: string }).title ?? (tool as { annotations?: { title?: string } }).annotations?.title;
	return defineTool({
		name: mcpToolName(server, tool.name),
		description: tool.description?.trim() || title || `MCP tool ${tool.name} from server ${server}`,
		parameters: (tool.inputSchema ?? { type: "object" }) as never,
		execute: async (args) => {
			const result = await client.request<{ content?: unknown[]; isError?: boolean }>("tools/call", {
				name: tool.name,
				arguments: args,
			});
			return { content: mapMcpContent(result.content ?? []) as never, isError: result.isError === true };
		},
	});
}

/** A `read_mcp_resource` tool when any server declares resources (task 5.1). */
export function createResourceTool(clients: ReadonlyMap<string, McpClient>): ToolRegistration {
	return defineTool({
		name: "read_mcp_resource",
		description: "Read a resource from a connected MCP server.",
		parameters: Type.Object({ server: Type.String(), uri: Type.String() }),
		execute: async (args) => {
			const client = clients.get(args.server);
			if (client === undefined) return { content: [{ type: "text", text: `Unknown MCP server: ${args.server}` }], isError: true };
			const result = await client.request<{ contents?: unknown[] }>("resources/read", { uri: args.uri });
			const contents = (result.contents ?? []) as readonly { text?: string; uri?: string }[];
			const text = contents.map((item) => item.text ?? JSON.stringify(item)).join("\n");
			return { content: [{ type: "text", text }] };
		},
	});
}

export interface LoadedMcp {
	readonly settings: McpSettings;
	readonly entries: readonly McpToolEntry[];
	readonly tools: readonly ToolRegistration[];
	readonly resourceServers: readonly string[];
	close(): Promise<void>;
}

async function connect(server: ResolvedServer, cwd: string): Promise<McpClient> {
	const config = server.transport ?? {};
	const client = new McpClient({ name: "durable-rpc-harness", version: "0.0.0" });
	if (config.command !== undefined) {
		await client.connect(
			new StdioTransport({
				command: config.command,
				...(config.args === undefined ? {} : { args: config.args }),
				cwd,
				inheritEnv: true,
				...(config.env === undefined ? {} : { env: config.env }),
			}),
		);
	} else if (config.url !== undefined) {
		await client.connect(
			new StreamableHttpTransport({
				url: config.url,
				...(config.headers === undefined ? {} : { headers: config.headers }),
			}),
		);
	}
	return client;
}

function widestExposure(servers: readonly (ResolvedServer | undefined)[]): ToolExposure {
	const exposures = new Set(servers.map((server) => server?.exposure).filter((value): value is ToolExposure => value !== undefined));
	if (exposures.has("direct")) return "direct";
	if (exposures.has("codemode")) return "codemode";
	if (exposures.has("codemode-deferred")) return "codemode-deferred";
	return "deferred";
}

/** Connect every enabled server, classify its tools, and collect its resources. */
export async function loadMcpTools(agentDir: string, cwd: string): Promise<LoadedMcp> {
	const settings = await loadMcpSettings(agentDir, cwd);
	const clients = new Map<string, McpClient>();
	const entries: McpToolEntry[] = [];
	const resourceServers: string[] = [];

	for (const server of settings.servers) {
		if (!server.enabled || server.transport === undefined || (server.transport.command === undefined && server.transport.url === undefined)) {
			continue;
		}
		try {
			const client = await connect(server, cwd);
			clients.set(server.name, client);
			const listed = await client.request<{ tools?: McpTool[] }>("tools/list");
			for (const tool of listed.tools ?? []) {
				const exposure = resolveToolExposure(server, tool.name);
				entries.push({
					name: mcpToolName(server.name, tool.name),
					server: server.name,
					toolName: tool.name,
					exposure,
					description: tool.description?.trim() || `MCP tool ${tool.name} from server ${server.name}`,
					inputSchema: tool.inputSchema,
					outputSchema: (tool as { outputSchema?: unknown }).outputSchema,
					annotations: (tool as { annotations?: unknown }).annotations,
					registration: createMcpTool(server.name, client, tool),
				});
			}
			try {
				const resources = await client.request<{ resources?: unknown[] }>("resources/list");
				if ((resources.resources ?? []).length > 0) resourceServers.push(server.name);
			} catch {
				// A server without resource support is not an error.
			}
		} catch (error) {
			process.stderr.write(`durable-rpc: MCP server ${server.name} failed: ${String(error)}\n`);
		}
	}

	const tools: ToolRegistration[] = entries.map((entry) => entry.registration);
	if (resourceServers.length > 0) {
		const registration = createResourceTool(clients);
		// Resource tools take the widest exposure among the servers that have resources.
		const exposure = widestExposure(resourceServers.map((name) => settings.servers.find((server) => server.name === name)));
		entries.push({
			name: "read_mcp_resource",
			server: resourceServers[0] ?? "",
			toolName: "read_mcp_resource",
			exposure,
			description: "Read a resource from a connected MCP server.",
			inputSchema: undefined,
			outputSchema: undefined,
			annotations: undefined,
			registration,
		});
		tools.push(registration);
	}

	return {
		settings,
		entries,
		tools,
		resourceServers,
		close: async () => {
			for (const client of clients.values()) await client.close().catch(() => {});
		},
	};
}

export { loadMcpSettings };
