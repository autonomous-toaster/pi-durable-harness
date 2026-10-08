/**
 * The codemode tool (task 7.2): run JavaScript in a QuickJS sandbox where the
 * agent's tools are callable as `tools.<name>(args)`. Reuses
 * `@earendil-works/pi-codemode`'s sandbox; the tool table is the calling
 * agent's offered tools, so a script can compose several tools in one call.
 */
import { CodemodeSandbox, type CodemodeResult } from "@earendil-works/pi-codemode";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolExecutionApi, type ToolRegistration, type ToolExecutionResult } from "@earendil-works/pi-durable";

function textOf(result: ToolExecutionResult): string {
	return (result.content ?? [])
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
}

function render(result: CodemodeResult): ToolExecutionResult {
	if (result.ok) {
		const value = result.value === undefined ? result.output : result.value;
		const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
		return { content: [{ type: "text", text }] };
	}
	return { content: [{ type: "text", text: result.error.message }], isError: true };
}

export const codemodeTool = defineTool({
	name: "codemode",
	description: "Run JavaScript that composes the available tools; call them as tools.<name>(args).",
	parameters: Type.Object({ code: Type.String() }),
	execute: async (args, api: ToolExecutionApi, context) => {
		const agent = await api.agent(context);
		const sandbox = new CodemodeSandbox();
		try {
			for (const tool of agent.tools as readonly ToolRegistration[]) {
				if (tool.name === "codemode") continue;
				sandbox.registerTool({
					name: tool.name,
					...(tool.description === undefined ? {} : { description: tool.description }),
					execute: async (toolArgs: unknown) => textOf(await tool.execute(toolArgs as never, api, context)),
				});
			}
			return render(await sandbox.execute(args.code));
		} finally {
			await sandbox.close();
		}
	},
});
