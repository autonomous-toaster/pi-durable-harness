/**
 * Process-wide exposure table (tasks 2.1-4.1). One session runs per process, so
 * the codemode and tool_search tools read the MCP exposure classification from
 * here. Non-MCP tools default to `direct`.
 */
import { isCallable, isDeclaredByDefault, type ToolExposure } from "./exposure.js";
import type { McpToolEntry } from "./mcp.js";

let entries: readonly McpToolEntry[] = [];

export function setMcpEntries(next: readonly McpToolEntry[]): void {
	entries = next;
}

export function mcpEntries(): readonly McpToolEntry[] {
	return entries;
}

/** The exposure of a tool: its MCP exposure, or `direct` for a built-in. */
export function exposureOf(name: string): ToolExposure {
	return entries.find((entry) => entry.name === name)?.exposure ?? "direct";
}

/** The server namespace of an MCP tool, if any. */
export function namespaceOf(name: string): string | undefined {
	return entries.find((entry) => entry.name === name)?.server;
}

export function entryOf(name: string): McpToolEntry | undefined {
	return entries.find((entry) => entry.name === name);
}

/** Whether a tool came from an MCP server (including the resource tool). */
export function isMcpTool(name: string): boolean {
	return entries.some((entry) => entry.name === name);
}

/** Whether a tool is declared to the model by default (direct or model-only). */
export function declaredByDefault(name: string): boolean {
	return isDeclaredByDefault(exposureOf(name));
}

/** Whether a tool is callable from codemode or tool_search. */
export function callable(name: string): boolean {
	return isCallable(exposureOf(name));
}
