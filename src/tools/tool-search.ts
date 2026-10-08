/**
 * The tool-search tool (task 4.1): search the registered tools that are not
 * declared to the model and ask durable to declare the matches. `addTools`
 * appends them to the conversation's explicit tool list, so they are declared
 * from the next request and recorded in the transcript.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolExecutionApi, type ToolRegistration } from "@earendil-works/pi-durable";
import { exposureOf } from "./state.js";
import { TOOL_SEARCH_DESCRIPTION, TOOL_SEARCH_PARAMETERS } from "./pi-definitions.js";

/** Exposures a search may load: the ones kept out of the model's declarations. */
const LOADABLE = new Set(["codemode", "codemode-deferred", "deferred"]);

export const toolSearchTool = defineTool({
	name: "tool_search",
	description: TOOL_SEARCH_DESCRIPTION,
	parameters: TOOL_SEARCH_PARAMETERS as never,
	execute: async (args, api: ToolExecutionApi) => {
		const { query: rawQuery, limit } = args as { query: string; limit?: number };
		const query = rawQuery.toLowerCase();
		const matches = (api.registry.tools() as readonly { tool: ToolRegistration }[])
			.map(({ tool }) => tool)
			.filter(
				(tool) =>
					tool.name !== "tool_search" &&
					LOADABLE.has(exposureOf(tool.name)) &&
					(tool.name.toLowerCase().includes(query) || (tool.description ?? "").toLowerCase().includes(query)),
			)
			.slice(0, limit ?? 8);
		const listed = matches.map((tool) => ({ name: tool.name, description: tool.description }));
		return {
			content: [{ type: "text", text: JSON.stringify(listed) }],
			control: { addTools: matches.map((tool) => tool.name) },
		};
	},
});
