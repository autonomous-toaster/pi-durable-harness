/**
 * MCP exposure model (tasks 1.1-1.3), matching pi-coding-agent:
 *  - `mcp.json` is read from the agent directory and the project; a project
 *    entry without a transport overrides only `enabled`, `exposure`, and
 *    `toolExposure` of the global server of the same name;
 *  - a server's `exposure` defaults to `codemode`;
 *  - `toolExposure` resolves an exact tool name over patterns; among patterns
 *    the first match wins; a `hidden` server exposes only the tools it lists;
 *  - a tool's namespace is its server.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The six exposures a tool can have (pi's `ToolExposure` plus MCP's codemode-deferred). */
export type ToolExposure = "direct" | "model-only" | "codemode" | "codemode-deferred" | "deferred" | "hidden";

const SERVER_EXPOSURES: readonly ToolExposure[] = ["direct", "model-only", "codemode", "codemode-deferred", "deferred", "hidden"];

export interface McpServerConfig {
	readonly command?: string;
	readonly args?: readonly string[];
	readonly env?: Record<string, string>;
	readonly url?: string;
	readonly headers?: Record<string, string>;
	readonly type?: string;
	readonly enabled?: boolean;
	readonly exposure?: string;
	readonly toolExposure?: Record<string, string>;
	readonly description?: string;
}

export interface McpFile {
	readonly mcpServers?: Record<string, McpServerConfig>;
	readonly autoEnableCodemode?: boolean;
}

export interface ResolvedServer {
	readonly name: string;
	readonly enabled: boolean;
	readonly exposure: ToolExposure;
	readonly toolExposure: Readonly<Record<string, string>>;
	readonly description?: string | undefined;
	readonly transport: McpServerConfig | undefined;
}

export interface McpSettings {
	readonly autoEnableCodemode: boolean;
	readonly servers: readonly ResolvedServer[];
	readonly warnings: readonly string[];
}

async function readJson(path: string): Promise<McpFile | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as McpFile;
	} catch {
		return undefined;
	}
}

function hasTransport(config: McpServerConfig): boolean {
	return config.command !== undefined || config.url !== undefined || config.type !== undefined;
}

/** Merge the global and project `mcp.json` (task 1.1). */
export function mergeMcpFiles(global: McpFile, project: McpFile): { servers: Record<string, McpServerConfig>; autoEnableCodemode: boolean | undefined } {
	const servers: Record<string, McpServerConfig> = { ...(global.mcpServers ?? {}) };
	for (const [name, entry] of Object.entries(project.mcpServers ?? {})) {
		const base = servers[name];
		if (hasTransport(entry) || base === undefined) {
			servers[name] = entry;
			continue;
		}
		servers[name] = {
			...base,
			...(entry.enabled === undefined ? {} : { enabled: entry.enabled }),
			...(entry.exposure === undefined ? {} : { exposure: entry.exposure }),
			...(entry.toolExposure === undefined ? {} : { toolExposure: entry.toolExposure }),
		};
	}
	return {
		servers,
		autoEnableCodemode: project.autoEnableCodemode ?? global.autoEnableCodemode,
	};
}

function validExposure(value: string | undefined, warnings: string[], where: string): ToolExposure | undefined {
	if (value === undefined) return undefined;
	if (SERVER_EXPOSURES.includes(value as ToolExposure)) return value as ToolExposure;
	warnings.push(`${where}: unknown exposure ${value}; using codemode`);
	return undefined;
}

/** Resolve enabled/exposure/toolExposure/autoEnableCodemode (task 1.2). */
export function resolveMcpSettings(config: McpFile, warnings: string[] = []): McpSettings {
	const servers: ResolvedServer[] = [];
	for (const [name, entry] of Object.entries(config.mcpServers ?? {})) {
		servers.push({
			name,
			enabled: entry.enabled !== false,
			exposure: validExposure(entry.exposure, warnings, `server ${name}`) ?? "codemode",
			toolExposure: entry.toolExposure ?? {},
			description: entry.description,
			transport: entry,
		});
	}
	return { autoEnableCodemode: config.autoEnableCodemode !== false, servers, warnings };
}

function globToRegExp(pattern: string): RegExp {
	return new RegExp(`^${pattern.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);
}

/** Resolve one tool's exposure from its server and the `toolExposure` overrides (task 1.3). */
export function resolveToolExposure(server: ResolvedServer, toolName: string): ToolExposure {
	const overrides = server.toolExposure;
	const exact = overrides[toolName];
	if (exact !== undefined && SERVER_EXPOSURES.includes(exact as ToolExposure)) return exact as ToolExposure;
	for (const [pattern, value] of Object.entries(overrides)) {
		if (!SERVER_EXPOSURES.includes(value as ToolExposure)) continue;
		if (globToRegExp(pattern).test(toolName)) return value as ToolExposure;
	}
	// A hidden server exposes only the tools it lists.
	return server.exposure === "hidden" ? "hidden" : server.exposure;
}

/** Which reaching tool a server needs: codemode for codemode tools, tool_search for deferred ones. */
export function serverReaches(server: ResolvedServer): { codemode: boolean; toolSearch: boolean } {
	const exposures = new Set<string>([server.exposure, ...Object.values(server.toolExposure)]);
	return {
		codemode: exposures.has("codemode") || exposures.has("codemode-deferred"),
		toolSearch: exposures.has("deferred"),
	};
}

/** Load and resolve `mcp.json` from the agent directory and the project (tasks 1.1, 1.2). */
export async function loadMcpSettings(agentDir: string, cwd: string): Promise<McpSettings> {
	const global = (await readJson(join(agentDir, "mcp.json"))) ?? {};
	const project = (await readJson(join(cwd, ".pi", "mcp.json"))) ?? {};
	const warnings: string[] = [];
	const merged = mergeMcpFiles(global, project);
	const settings = resolveMcpSettings(
		{
			mcpServers: merged.servers,
			...(merged.autoEnableCodemode === undefined ? {} : { autoEnableCodemode: merged.autoEnableCodemode }),
		},
		warnings,
	);
	return { ...settings, warnings };
}

/** Whether a tool of the given exposure is declared to the model when active. */
export function isDeclaredByDefault(exposure: ToolExposure): boolean {
	return exposure === "direct" || exposure === "model-only";
}

/** Whether a tool of the given exposure is callable from codemode or tool_search. */
export function isCallable(exposure: ToolExposure): boolean {
	return exposure === "direct" || exposure === "codemode" || exposure === "codemode-deferred" || exposure === "deferred";
}
