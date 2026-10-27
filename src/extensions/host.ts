/**
 * pi extension host (tasks 3.1-3.11).
 *
 * The resource loader runs each pi extension factory against pi's own
 * `ExtensionAPI`, which records what the extension registered into plain maps
 * (`tools`, `handlers`, `commands`, `flags`, `shortcuts`) and queues provider
 * registrations. Nothing here re-implements that recording; this module only
 * translates the recorded declarations into durable primitives and reports the
 * surfaces the harness does not host.
 */
import type { Extension as PiExtension, ModelRuntime, ProviderConfig, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import {
	CompactionTask,
	GenerationTask,
	ToolTask,
	defineExtension,
	defineTool,
	hook,
	type Extension as DurableExtension,
	type ToolExecutionResult,
	type ToolRegistration,
} from "@earendil-works/pi-durable";

/** One diagnostic for an extension surface the harness does not host (task 3.6). */
export interface SurfaceDiagnostic {
	readonly extension: string;
	readonly surface: string;
}

/** The classification of every pi extension surface (task 3.5). */
export interface CapabilityClassification {
	readonly hosted: readonly string[];
	readonly unsupported: readonly SurfaceDiagnostic[];
}

/**
 * pi events the harness hosts. `context` and `context_with_system` edit the
 * message list, `tool_call`/`tool_result` wrap a call, and
 * `session_before_compact` can decline a summary; each has a durable hook of
 * the same reach. The session-lifecycle events are consulted by the harness.
 */
const HOSTED_EVENTS = new Set([
	"context",
	"context_with_system",
	"tool_call",
	"tool_result",
	"session_before_compact",
	"session_before_fork",
	"session_before_switch",
	"session_before_tree",
]);

/**
 * Classify one extension: what it registered, and what cannot be hosted
 * (task 3.5). A provider registration is hosted through the model runtime, so
 * it is hosted; everything with no durable or harness counterpart is reported.
 */
export function classifyExtension(extension: PiExtension): CapabilityClassification {
	const hosted: string[] = [];
	const unsupported: SurfaceDiagnostic[] = [];
	const report = (surface: string): void => {
		unsupported.push({ extension: extension.path, surface });
	};

	if (extension.tools.size > 0) hosted.push("registerTool");
	if (extension.commands.size > 0) hosted.push("registerCommand");
	for (const event of extension.handlers.keys()) {
		if (HOSTED_EVENTS.has(event)) hosted.push(event);
		else report(event);
	}
	if (extension.flags.size > 0) report("registerFlag");
	if (extension.shortcuts.size > 0) report("registerShortcut");
	if (extension.messageRenderers.size > 0) report("registerMessageRenderer");
	if ((extension.toolRenderers?.length ?? 0) > 0) report("registerToolRenderer");
	if (extension.entryRenderers !== undefined) report("registerEntryRenderer");
	if (extension.markdownTransformer !== undefined) report("registerMarkdownTransformer");
	return { hosted, unsupported };
}

/** A message for one diagnostic line (task 3.6). */
export function formatDiagnostic(diagnostic: SurfaceDiagnostic): string {
	return `durable-rpc: extension ${diagnostic.extension} uses an unhosted surface: ${diagnostic.surface}`;
}

/** Emit one stderr line per unhosted surface; the run continues (tasks 3.6, 3.7). */
export function reportDiagnostics(
	diagnostics: readonly SurfaceDiagnostic[],
	write: (text: string) => void = (text) => void process.stderr.write(text),
): void {
	for (const diagnostic of diagnostics) write(`${formatDiagnostic(diagnostic)}\n`);
}

type PiHandler = (...args: never[]) => unknown;

/** `ctx.ui` for an extension that expects pi's UI in RPC mode: every call is inert. */
function inertUi(): Record<string, unknown> {
	const noop = (): undefined => undefined;
	return {
		select: async () => undefined,
		confirm: async () => false,
		input: async () => undefined,
		editor: async () => undefined,
		custom: async () => undefined,
		notify: noop,
		setStatus: noop,
		setWidget: noop,
		setTitle: noop,
		setWorkingMessage: noop,
		setWorkingVisible: noop,
		setWorkingIndicator: noop,
		setHiddenThinkingLabel: noop,
		setFooter: noop,
		setHeader: noop,
		pasteToEditor: noop,
		setEditorText: noop,
		addAutocompleteProvider: noop,
		setEditorComponent: noop,
		getEditorText: () => "",
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "Theme switching not supported in RPC mode" }),
	};
}

/** Translate an extension's tools into durable tools (task 3.2). */
function translateTools(extension: PiExtension): ToolRegistration[] {
	const tools: ToolRegistration[] = [];
	for (const [name, registered] of extension.tools) {
		const definition = registered.definition;
		tools.push(
			defineTool({
				name,
				description: definition.description,
				parameters: definition.parameters as never,
				replay: "unsafe",
				execute: async (args, api, context) => {
					const ctx = { cwd: api.env?.cwd, ui: inertUi() };
					const result = (await definition.execute(name, args as never, undefined, undefined, ctx as never)) as {
						readonly content?: ToolExecutionResult["output"];
						readonly isError?: boolean;
						readonly details?: unknown;
					};
					void context;
					return {
						...(result.content === undefined ? {} : { output: result.content }),
						...(result.isError === undefined ? {} : { isError: result.isError }),
						...(result.details === undefined ? {} : { details: result.details as never }),
					};
				},
			}),
		);
	}
	return tools;
}

/**
 * Translate one pi extension into a durable extension (tasks 3.2-3.4, 3.7).
 * Tools become durable tools, and the hosted lifecycle events become durable
 * task hooks that run in registration order.
 */
export function translateExtension(extension: PiExtension): DurableExtension {
	const handlers = (event: string): readonly PiHandler[] => (extension.handlers.get(event) ?? []) as readonly PiHandler[];
	const anyHandler = (event: string): boolean => handlers(event).length > 0;

	const tools = translateTools(extension);
	const hooks = [];

	// `context` then `context_with_system`: both replace the message list (task 3.3).
	if (anyHandler("context") || anyHandler("context_with_system")) {
		hooks.push(
			hook(GenerationTask, {
				beforeRequest: async (request) => {
					let messages = request.messages;
					for (const handler of [...handlers("context"), ...handlers("context_with_system")]) {
						const next = (await handler({ type: "context", messages } as never, {} as never)) as
							| { readonly messages?: readonly unknown[] }
							| undefined;
						if (Array.isArray(next?.messages)) messages = next.messages as never;
					}
					return messages === request.messages ? undefined : { messages };
				},
			}),
		);
	}
	if (anyHandler("tool_call")) {
		hooks.push(
			hook(ToolTask, {
				beforeTool: async (call) => {
					for (const handler of handlers("tool_call")) {
						const result = (await handler(call as never, {} as never)) as
							| { readonly block?: string; readonly arguments?: unknown }
							| undefined;
						if (result?.block !== undefined) return { block: result.block };
						if (result?.arguments !== undefined) return { arguments: result.arguments as never };
					}
					return undefined;
				},
			}),
		);
	}
	if (anyHandler("tool_result")) {
		hooks.push(
			hook(ToolTask, {
				afterTool: async (call, result) => {
					let current = result;
					for (const handler of handlers("tool_result")) {
						const next = (await handler(call as never, current as never)) as ToolExecutionResult | undefined;
						if (next !== undefined) current = next;
					}
					return current === result ? undefined : current;
				},
			}),
		);
	}
	if (anyHandler("session_before_compact")) {
		hooks.push(
			hook(CompactionTask, {
				beforeCompact: async (compaction) => {
					for (const handler of handlers("session_before_compact")) {
						const result = (await handler(compaction as never, {} as never)) as { readonly cancel?: boolean } | undefined;
						if (result?.cancel === true) return { decline: true };
					}
					return undefined;
				},
			}),
		);
	}

	return defineExtension({
		name: `pi-extension:${extension.path}`,
		...(tools.length === 0 ? {} : { tools }),
		...(hooks.length === 0 ? {} : { hooks }),
	});
}

/** The command handlers of one extension, keyed by command name (tasks 3.9, 3.10). */
export function extensionCommands(extension: PiExtension): Map<string, RegisteredCommand> {
	return extension.commands;
}

/** Flush pi's queued provider registrations into the harness model runtime (task 3.8). */
export function applyProviders(
	pending: readonly { readonly name: string; readonly config: unknown }[],
	modelRuntime: ModelRuntime,
): void {
	for (const registration of pending) {
		modelRuntime.registerProvider(registration.name, registration.config as ProviderConfig);
	}
}
