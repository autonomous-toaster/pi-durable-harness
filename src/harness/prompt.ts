/** pi's system prompt as one durable extension (tasks 5.2-5.4, 5.9). The
 * sections are built by a port of pi's own section builder from the declared
 * tool set, the built-in tool snippets and guidelines, the loaded context
 * files and skills, and the `mcp_servers` text.
 */
import type { PromptInput, ToolRegistration } from "@earendil-works/pi-durable";
import { defineExtension, section } from "@earendil-works/pi-durable";
import type { PromptTemplate, Skill } from "@earendil-works/pi-coding-agent";
import { serverReaches, type ResolvedServer } from "../tools/exposure.js";
import { CODEMODE_CONTRIBUTION, PI_TOOL_DEFINITIONS, TOOL_SEARCH_CONTRIBUTION } from "../tools/pi-definitions.js";
import { buildSystemPromptSections, type SystemPromptSections } from "./system-prompt.js";

export interface PromptResources {
	readonly cwd: string;
	readonly agentsFiles: readonly { readonly path: string; readonly content: string }[];
	readonly skills: readonly Skill[];
	readonly prompts: readonly PromptTemplate[];
	readonly systemPrompt?: string | undefined;
	readonly appendSystemPrompt: readonly string[];
}

/** pi's tool snippets and guidelines: the built-in tools plus codemode/tool_search. */
export const TOOL_CONTRIBUTIONS: Readonly<Record<string, { readonly snippet: string; readonly guidelines: readonly string[] }>> = {
	...Object.fromEntries(
		Object.entries(PI_TOOL_DEFINITIONS).map(([name, definition]) => [
			name,
			{ snippet: definition.snippet, guidelines: definition.guidelines },
		]),
	),
	codemode: CODEMODE_CONTRIBUTION,
	tool_search: TOOL_SEARCH_CONTRIBUTION,
};

export const MAX_SERVER_DESCRIPTION_CHARS = 250;
export const MAX_SERVERS_SECTION_CHARS = 4096;

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return max <= 1 ? "" : `${text.slice(0, max - 1).trimEnd()}…`;
}

function serversIntro(reaches: ReadonlySet<string>): string {
	let intro = "MCP servers whose tools are not declared to you.";
	if (reaches.has("codemode")) intro += " Call the tools of `codemode` servers from codemode scripts.";
	if (reaches.has("tool_search")) intro += " Load the tools of `tool_search` servers with `tool_search`.";
	return intro;
}

/** pi's `mcp_servers` section: every codemode/deferred server with its reach and a one-line summary (task 5.9). */
export function renderMcpServers(servers: readonly ResolvedServer[]): string | undefined {
	const listed = servers
		.filter((server) => server.enabled && (serverReaches(server).codemode || serverReaches(server).toolSearch))
		.sort((a, b) => a.name.localeCompare(b.name));
	if (listed.length === 0) return undefined;
	const reaches = listed.map((server) => (serverReaches(server).codemode ? "codemode" : "tool_search"));
	const intro = serversIntro(new Set(reaches));
	const heads = listed.map((server, index) => `- mcp__${server.name} (${reaches[index]})`);
	const omitted = (count: number): string[] =>
		count > 0 ? [`- … ${count} more server${count === 1 ? "" : "s"}; find their tools with searchTools()`] : [];
	const size = (kept: number): number =>
		[intro, ...heads.slice(0, kept), ...omitted(listed.length - kept)].join("\n").length;
	let kept = listed.length;
	while (kept > 0 && size(kept) > MAX_SERVERS_SECTION_CHARS) kept--;
	const perServer =
		kept === 0 ? 0 : Math.min(MAX_SERVER_DESCRIPTION_CHARS, Math.floor((MAX_SERVERS_SECTION_CHARS - size(kept)) / kept) - 2);
	const lines = listed.slice(0, kept).map((server, index) => {
		const summary = perServer > 0 ? truncate(server.description?.split("\n", 1)[0]?.trim() ?? "", perServer) : "";
		return summary ? `${heads[index]}: ${summary}` : heads[index];
	});
	return [intro, ...lines, ...omitted(listed.length - kept)].join("\n");
}

/** pi renders these sections, in this order. */
const SECTION_KEYS = ["preamble", "tools", "rules", "docs", "addendum", "project_context", "skills", "cwd", "mcp_servers"] as const;

/** Build the prompt extension from resources loaded once at startup (tasks 5.2-5.4). */
export function createPromptExtension(resources: PromptResources, servers: readonly ResolvedServer[] = []) {
	const toolSnippets = Object.fromEntries(Object.entries(TOOL_CONTRIBUTIONS).map(([name, c]) => [name, c.snippet]));
	const toolGuidelines = Object.fromEntries(Object.entries(TOOL_CONTRIBUTIONS).map(([name, c]) => [name, [...c.guidelines]]));
	const mcpServers = renderMcpServers(servers);
	const sectionsFor = (input: PromptInput<ToolRegistration>): SystemPromptSections =>
		buildSystemPromptSections({
			...(resources.systemPrompt === undefined ? {} : { customPrompt: resources.systemPrompt }),
			selectedTools: input.agent.tools.map((tool) => tool.name),
			toolSnippets,
			toolGuidelines,
			appendSystemPrompt: resources.appendSystemPrompt.join("\n\n"),
			...(mcpServers === undefined ? {} : { sections: { mcp_servers: mcpServers } }),
			cwd: input.env?.cwd ?? input.agent.cwd ?? resources.cwd,
			contextFiles: resources.agentsFiles,
			skills: [...resources.skills],
		});
	return defineExtension({
		name: "harness.prompt",
		sections: SECTION_KEYS.map((key) => section(key, (input) => sectionsFor(input)[key], { tag: false })),
	});
}
