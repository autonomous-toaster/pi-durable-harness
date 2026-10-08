/**
 * The tool-search tool (task 7.3): search the tools available to the calling
 * agent by name or description and return the matches, so an agent can find a
 * capability it was not offered directly.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolExecutionApi } from "@earendil-works/pi-durable";

export const toolSearchTool = defineTool({
	name: "tool_search",
	description: "Search the available tools by name or description and list the matches.",
	parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number()) }),
	execute: async (args, api: ToolExecutionApi, context) => {
		const agent = await api.agent(context);
		const query = args.query.toLowerCase();
		const matches = agent.tools
			.filter(
				(tool) =>
					tool.name !== "tool_search" &&
					(tool.name.toLowerCase().includes(query) || (tool.description ?? "").toLowerCase().includes(query)),
			)
			.slice(0, args.limit ?? 10)
			.map((tool) => ({ name: tool.name, description: tool.description }));
		return { content: [{ type: "text", text: JSON.stringify(matches) }] };
	},
});
