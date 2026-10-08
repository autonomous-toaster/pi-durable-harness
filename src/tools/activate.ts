/**
 * Activation and declared-set computation (tasks 2.1, 2.2), matching pi:
 *  - codemode is active when a codemode/codemode-deferred server connects
 *    (unless autoEnableCodemode is false) or settings force it;
 *  - tool_search is active when a deferred server connects or settings force it;
 *  - the declared set is every installed tool that is direct or model-only,
 *    plus the activated codemode/tool_search.
 */
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { serverReaches, type ResolvedServer } from "./exposure.js";
import { declaredByDefault, isMcpTool } from "./state.js";

export interface Activation {
	readonly codemode: boolean;
	readonly toolSearch: boolean;
	readonly warnings: readonly string[];
}

export function computeActivation(
	servers: readonly ResolvedServer[],
	autoEnableCodemode: boolean,
	defaultTools: readonly string[],
): Activation {
	const forces = (name: string): boolean => defaultTools.includes(`+${name}`);
	const reachesCodemode = servers.some((server) => serverReaches(server).codemode);
	const reachesToolSearch = servers.some((server) => serverReaches(server).toolSearch);
	const codemode = forces("codemode") || (reachesCodemode && autoEnableCodemode);
	const toolSearch = forces("tool_search") || reachesToolSearch;
	const warnings: string[] = [];
	if (reachesCodemode && !codemode) warnings.push("MCP tools need codemode, which is not active");
	if (reachesToolSearch && !toolSearch) warnings.push("MCP tools need tool_search, which is not active");
	return { codemode, toolSearch, warnings };
}

/** Tools pi declares by default; `ls`, `find`, and `grep` are installed but off. */
const DEFAULT_ACTIVE = new Set(["read", "bash", "edit", "write", ...(process.platform === "win32" ? ["powershell"] : [])]);

/** pi's declaration order: built-ins first, then codemode, tool_search, then MCP tools. */
const DECLARATION_ORDER: Readonly<Record<string, number>> = {
	read: 0,
	bash: 1,
	edit: 2,
	write: 3,
	powershell: 4,
	ls: 5,
	find: 6,
	grep: 7,
	codemode: 1001,
	tool_search: 1002,
};

function rank(name: string): number {
	return DECLARATION_ORDER[name] ?? 2000;
}

export function computeDeclaredTools(
	allTools: readonly ToolRegistration[],
	activation: Activation,
	defaultTools: readonly string[] = [],
): ToolRegistration[] {
	const added = new Set(defaultTools.filter((name) => name.startsWith("+")).map((name) => name.slice(1)));
	const removed = new Set(defaultTools.filter((name) => name.startsWith("-")).map((name) => name.slice(1)));
	return allTools
		.filter((tool) => {
			const name = tool.name;
			if (added.has(name)) return true;
			if (removed.has(name)) return false;
			if (name === "codemode") return activation.codemode;
			if (name === "tool_search") return activation.toolSearch;
			if (isMcpTool(name)) return declaredByDefault(name);
			return DEFAULT_ACTIVE.has(name);
		})
		.map((tool, index) => ({ tool, index }))
		.sort((a, b) => rank(a.tool.name) - rank(b.tool.name) || a.index - b.index)
		.map(({ tool }) => tool);
}
