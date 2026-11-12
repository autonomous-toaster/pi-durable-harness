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
	toCodemodeIdentifier,
	type CodemodeOutputItem,
	type CodemodeResult,
	type CodemodeSandboxBase,
	type CodemodeTool,
} from "@earendil-works/pi-codemode";
import { defineTool, type ToolExecutionApi, type ToolRegistration, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { callable, mcpEntries, scriptCallable } from "./state.js";
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

/** The value a script receives: `structuredOutput` when declared, else the text. */
function scriptValue(tool: ToolRegistration, result: ToolExecutionResult): unknown {
	const structured = (result as { readonly structuredOutput?: unknown }).structuredOutput;
	const text = textOf(result);
	if (result.isError === true) {
		throw new Error(text.length > 0 ? text : structured === undefined ? `Tool "${tool.name}" failed` : JSON.stringify(structured));
	}
	const declares = (tool as { readonly structuredOutputSchema?: unknown }).structuredOutputSchema !== undefined;
	if (declares && structured !== undefined) return structured;
	return text.length > 0 ? text : (structured ?? "");
}

function textOf(result: ToolExecutionResult): string {
	return (result.output ?? [])
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
}

/**
 * pi's codemode renderer draws the nested calls from `details`, so a script that
 * called three tools lists them; without it the row shows the output alone and the
 * collapsed preview is the wrong height.
 */
interface CallRecord {
	readonly id: string;
	readonly name: string;
	/** pi's renderer reads a string preview, not the arguments themselves. */
	readonly args: string;
	status: string;
	durationMs: number;
	error?: string;
}

/** The argument preview pi shows beside a nested call. */
function previewArgs(args: unknown): string {
	try {
		return (JSON.stringify(args) ?? "").slice(0, 200);
	} catch {
		return "";
	}
}

/** pi's value text: a string as is, anything else compact JSON. */
function valueText(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value) ?? String(value);
}

/**
 * The script's items as the model sees them: with more than one text item each is
 * marked, and `console.*` output follows the rest in its own block.
 */
function formatOutput(output: readonly CodemodeOutputItem[]): Record<string, unknown>[] {
	const total = output.filter((item) => item.type === "text" && item.console !== true).length;
	const items: Record<string, unknown>[] = [];
	const consoleLines: string[] = [];
	let index = 0;
	for (const item of output) {
		if (item.type === "image") {
			items.push({ type: "image", data: item.data, mimeType: item.mimeType });
		} else if (item.console === true) {
			consoleLines.push(item.text);
		} else {
			index++;
			items.push({ type: "text", text: total > 1 ? `==> text ${index}/${total} <==\n${item.text}` : item.text });
		}
	}
	if (consoleLines.length > 0) {
		items.push({ type: "text", text: `<console_output>\n${consoleLines.join("\n")}\n</console_output>` });
	}
	return items;
}

/** Adjacent text items joined, each part starting on its own line (pi's own join). */
function joinAdjacentText(items: readonly Record<string, unknown>[]): Record<string, unknown>[] {
	const joined: Record<string, unknown>[] = [];
	let parts: string[] = [];
	let lastPart = "";
	const flush = (): void => {
		if (parts.length > 0) joined.push({ type: "text", text: parts.join("") });
		parts = [];
		lastPart = "";
	};
	for (const item of items) {
		if (item.type !== "text") {
			flush();
			joined.push(item);
			continue;
		}
		const text = String(item.text ?? "");
		if (lastPart !== "" && !lastPart.endsWith("\n")) {
			parts.push("\n");
			lastPart = "\n";
		}
		parts.push(text);
		if (text !== "") lastPart = text;
	}
	flush();
	return joined;
}

/** pi's failure text: the script's stack, or the kind, then the calls already made. */
function formatError(result: CodemodeResult, calls: readonly CallRecord[]): string {
	if (result.ok) return "";
	const { error } = result;
	const head =
		error.kind === "script"
			? (error.stack ?? `${error.name ?? "Error"}: ${error.message}`)
			: error.kind === "timeout"
				? `Script timed out: ${error.message}`
				: error.kind === "aborted"
					? `Script aborted: ${error.message}`
					: `Script sandbox failed: ${error.message}`;
	const summary =
		calls.length === 0
			? "No tool calls were made."
			: `Tool calls made before the failure (they are not undone): ${calls.map((call) => `${call.name} (${call.status})`).join(", ")}`;
	return `${head}\n\n${summary}`;
}

/**
 * pi's codemode result, item for item: a header block the renderer strips, then the
 * script's output with the returned value appended as text. The header is what the
 * renderer matches on, and the joined output is what its preview counts lines of.
 */
function render(result: CodemodeResult, records: readonly CallRecord[] = [], wallSeconds = 0): ToolExecutionResult {
	// The sandbox reports names and timings only; our wrappers also saw the arguments.
	const calls =
		records.length > 0
			? records.map((record) => ({ ...record }))
			: (result.calls ?? []).map((call, index) => ({
					id: String(index + 1),
					name: call.name,
					args: "",
					status: call.status,
					durationMs: call.durationMs,
				}));
	const details = { calls };
	const output: CodemodeOutputItem[] = [...(result.output ?? [])];
	if (result.ok && result.value !== undefined) output.push({ type: "text", text: valueText(result.value) });
	const items = formatOutput(output);
	if (!result.ok) items.push({ type: "text", text: `Script error:\n${formatError(result, calls)}` });
	const header = `${result.ok ? "Script completed" : "Script failed"}\nWall time ${wallSeconds.toFixed(1)} seconds\nOutput:\n`;
	return {
		output: [{ type: "text", text: header }, ...joinAdjacentText(items)] as never,
		details,
		...(result.ok ? {} : { isError: true }),
	};
}

/** pi's composed codemode description from the callable tools (task 5.6). */
export async function renderCodemodeDescription(tools: readonly ToolRegistration[]): Promise<string> {
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
/**
 * `searchTools`, `describeTool`, and `describeNamespace`, as pi's own codemode exposes
 * them to a script. They are globals, so a script calls `searchTools("…")` directly.
 */
function discoveryGlobals(catalog: readonly DiscoveryEntry[]): CodemodeTool[] {
	const id = (name: string): string => toCodemodeIdentifier(name);
	return [
		{
			name: "searchTools",
			spread: true,
			description: "Rank the tools a script can call.",
			execute: (args: unknown) => {
				const [query, options] = args as [unknown, { readonly limit?: number; readonly namespace?: string } | undefined];
				if (typeof query !== "string") throw new Error("searchTools() expects a query string");
				const limit = options?.limit ?? 10;
				if (!Number.isInteger(limit) || limit <= 0) throw new Error("searchTools() limit must be a positive integer");
				const wanted = query.toLowerCase();
				return catalog
					.filter((entry) => options?.namespace === undefined || entry.namespace === options.namespace)
					.map((entry) => {
						const name = id(entry.name).toLowerCase();
						const score = name.includes(wanted) ? 2 : entry.description.toLowerCase().includes(wanted) ? 1 : 0;
						return { entry, score };
					})
					.filter((match) => match.score > 0)
					.sort((first, second) => second.score - first.score)
					.slice(0, limit)
					.map((match) => ({ name: id(match.entry.name), description: match.entry.description }));
			},
		},
		{
			name: "describeTool",
			spread: true,
			description: "Show a tool's declaration, or undefined when there is none.",
			execute: (args: unknown) => {
				const [name] = args as [unknown];
				if (typeof name !== "string") throw new Error("describeTool() expects a tool name");
				const entry = catalog.find((candidate) => candidate.name === name || id(candidate.name) === name);
				if (entry === undefined) return undefined;
				return `${id(entry.name)}: ${entry.description}`;
			},
		},
		{
			name: "describeNamespace",
			spread: true,
			description: "List the tools of an MCP namespace.",
			execute: (args: unknown) => {
				const [name] = args as [unknown];
				if (typeof name !== "string") throw new Error("describeNamespace() expects a namespace name");
				const members = catalog.filter((entry) => entry.namespace === name);
				if (members.length === 0) return undefined;
				return { name, tools: members.map((entry) => ({ name: id(entry.name), description: entry.description })) };
			},
		},
	];
}

interface DiscoveryEntry {
	readonly name: string;
	readonly description: string;
	readonly namespace?: string;
}

export async function createSandbox(globals: readonly CodemodeTool[] = []): Promise<CodemodeSandboxBase> {
	try {
		// `import.meta.resolve` follows the package's `import` condition, which is
		// the only one it exports (`require` cannot see `./worker`).
		return new CodemodeSandbox({
			workerUrl: new URL(import.meta.resolve("@earendil-works/pi-codemode/worker")),
			globals: [...globals],
		});
	} catch {
		return new InlineCodemodeSandbox({ wasm: (await bundledWasm()) as never, globals: [...globals] });
	}
}

export const codemodeTool = defineTool({
	name: "codemode",
	description: CODEMODE_DESCRIPTION,
	parameters: CODEMODE_PARAMETERS as never,
	execute: async (args, api: ToolExecutionApi, context) => {
		// The catalog the discovery helpers answer from, built before the sandbox so the
		// globals can close over it.
		const callableTools = (api.registry.tools() as readonly { tool: ToolRegistration }[])
			.map((entry) => entry.tool)
			.filter((tool) => tool.name !== "codemode" && scriptCallable(tool.name));
		const catalog: DiscoveryEntry[] = callableTools.map((tool) => {
			const entry = mcpEntries().find((candidate) => candidate.name === tool.name);
			return {
				name: tool.name,
				description: tool.description ?? "",
				...(entry === undefined ? {} : { namespace: `mcp__${entry.server}` }),
			};
		});
		const sandbox = await createSandbox(discoveryGlobals(catalog));
		const records: CallRecord[] = [];
		try {
			for (const { tool } of api.registry.tools() as readonly { tool: ToolRegistration }[]) {
				if (tool.name === "codemode" || !scriptCallable(tool.name)) continue;
				sandbox.registerTool({
					name: tool.name,
					...(tool.description === undefined ? {} : { description: tool.description }),
					execute: async (toolArgs: unknown) => {
						const record: CallRecord = {
							id: String(records.length + 1),
							name: tool.name,
							args: previewArgs(toolArgs),
							status: "running",
							durationMs: 0,
						};
						records.push(record);
						const startedAt = performance.now();
						try {
							const value = scriptValue(tool, await tool.execute(toolArgs as never, api, context));
							record.status = "ok";
							return value;
						} catch (error) {
							record.status = "error";
							record.error = String(error instanceof Error ? error.message : error).slice(0, 200);
							throw error;
						} finally {
							record.durationMs = performance.now() - startedAt;
						}
					},
				});
			}
			const startedAt = performance.now();
			const result = await sandbox.execute((args as { code: string }).code);
			return render(result, records, (performance.now() - startedAt) / 1000);
		} finally {
			await sandbox.close();
		}
	},
});

/** Apply pi's composed description once the exposure table and the callable set are known (task 5.6). */
export async function configureCodemodeDescription(tools: readonly ToolRegistration[] = []): Promise<void> {
	codemodeTool.description = await renderCodemodeDescription(tools);
}
