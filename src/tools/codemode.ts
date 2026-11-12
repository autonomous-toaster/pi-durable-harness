/**
 * The codemode tool (tasks 3.1, 3.2): run JavaScript in a QuickJS sandbox where
 * callable tools are exposed as `tools.<name>(args)`. The table is built from
 * the registry filtered by exposure, so MCP tools that are not declared to the
 * model are still callable from a script. The declaration text is rendered with
 * pi-codemode's helpers, grouped by server namespace and kept within a budget.
 */
import {
	CodemodeSandbox,
	InlineCodemodeSandbox,
	loadQuickJSWasm,
	type CodemodeResult,
	type CodemodeSandboxBase,
} from "@earendil-works/pi-codemode";
import { defineTool, type ToolExecutionApi, type ToolRegistration, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { callable, mcpEntries } from "./state.js";
import {
	CODEMODE_CONTRIBUTION,
	CODEMODE_DESCRIPTION,
	CODEMODE_PARAMETERS,
	PI_TOOL_DEFINITIONS,
	PI_TOOL_OUTPUT_SCHEMAS,
	TOOL_SEARCH_CONTRIBUTION,
} from "./pi-definitions.js";
import {
	createCodemodeDescription as piCreateCodemodeDescription,
	DEFAULT_CODEMODE_INLINE_BUDGET,
} from "../harness/pi-internals.js";

function textOf(result: ToolExecutionResult): string {
	return (result.output ?? [])
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
}

function render(result: CodemodeResult): ToolExecutionResult {
	if (result.ok) {
		const value = result.value === undefined ? result.output : result.value;
		const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
		return { output: [{ type: "text", text }] };
	}
	return { output: [{ type: "text", text: result.error.message }], isError: true };
}

/** pi's composed codemode description from the callable tools (task 5.6). */
export function renderCodemodeDescription(tools: readonly ToolRegistration[]): string {
	const entries = mcpEntries();
	const namespaces = new Map(entries.map((entry) => [entry.name, { name: `mcp__${entry.server}` }]));
	const guidelines = new Map<string, readonly string[]>(
		Object.entries(PI_TOOL_DEFINITIONS).map(([name, definition]) => [name, definition.guidelines]),
	);
	guidelines.set("codemode", CODEMODE_CONTRIBUTION.guidelines);
	guidelines.set("tool_search", TOOL_SEARCH_CONTRIBUTION.guidelines);
	const deferred = new Set(
		entries.filter((entry) => entry.exposure === "deferred" || entry.exposure === "codemode").map((entry) => entry.name),
	);
	const piTools = tools.map((tool) => {
		const entry = entries.find((candidate) => candidate.name === tool.name);
		const outputSchema = entry?.outputSchema ?? PI_TOOL_OUTPUT_SCHEMAS[tool.name];
		return {
			name: tool.name,
			description: tool.description ?? "",
			parameters: (tool as { readonly parameters?: unknown }).parameters,
			...(outputSchema === undefined ? {} : { outputSchema }),
		};
	});
	return piCreateCodemodeDescription(piTools, {
		namespaces,
		guidelines,
		deferred,
		models: true,
		inlineBudget: DEFAULT_CODEMODE_INLINE_BUDGET,
	});
}

/**
 * The QuickJS wasm, inlined by the bundler when the file is packed (esbuild maps
 * `.wasm` to a byte array). The plain `dist/` build cannot import a `.wasm`
 * specifier, so it falls back to pi-codemode's own file lookup.
 */
async function bundledWasm(): Promise<unknown> {
	try {
		// @ts-expect-error -- only the bundler resolves a `.wasm` specifier.
		const module = await import("quickjs-wasi/quickjs.wasm");
		const bytes: unknown = module.default ?? module;
		// The Node type definitions do not declare the WebAssembly globals.
		const wasm = (globalThis as unknown as { WebAssembly: { compile(b: ArrayBuffer): Promise<unknown> } }).WebAssembly;
		return await wasm.compile(bytes as ArrayBuffer);
	} catch {
		return loadQuickJSWasm();
	}
}

/**
 * A sandbox for this build (tasks: bundle parity). The worker keeps the VM off
 * the event loop, which is what lets Stop and progress work while a script runs;
 * it needs a worker file, so a single-file bundle falls back to the inline
 * sandbox with the wasm compiled from the bundle itself. That fallback trades
 * the deadline timer for an interrupt budget, which pi-codemode documents.
 */
export async function createSandbox(): Promise<CodemodeSandboxBase> {
	try {
		// `import.meta.resolve` follows the package's `import` condition, which is
		// the only one it exports (`require` cannot see `./worker`).
		return new CodemodeSandbox({ workerUrl: new URL(import.meta.resolve("@earendil-works/pi-codemode/worker")) });
	} catch {
		return new InlineCodemodeSandbox({ wasm: (await bundledWasm()) as never });
	}
}

export const codemodeTool = defineTool({
	name: "codemode",
	description: CODEMODE_DESCRIPTION,
	parameters: CODEMODE_PARAMETERS as never,
	execute: async (args, api: ToolExecutionApi, context) => {
		const sandbox = await createSandbox();
		try {
			for (const { tool } of api.registry.tools() as readonly { tool: ToolRegistration }[]) {
				if (tool.name === "codemode" || !callable(tool.name)) continue;
				sandbox.registerTool({
					name: tool.name,
					...(tool.description === undefined ? {} : { description: tool.description }),
					execute: async (toolArgs: unknown) => textOf(await tool.execute(toolArgs as never, api, context)),
				});
			}
			return render(await sandbox.execute((args as { code: string }).code));
		} finally {
			await sandbox.close();
		}
	},
});

/** Apply pi's composed description once the exposure table and the callable set are known (task 5.6). */
export function configureCodemodeDescription(tools: readonly ToolRegistration[] = []): void {
	codemodeTool.description = renderCodemodeDescription(tools);
}
