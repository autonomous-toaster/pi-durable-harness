/**
 * The runtime pi's `InteractiveMode` drives, served by the durable engine
 * (tasks 3.1-3.3, 4.1-4.4).
 *
 * pi's TUI asks for an `AgentSessionRuntime`: a `session` with synchronous state
 * getters and loop operations, a `sessionManager` with the pi session-entry
 * tree, and the cwd-bound `services`. Here each answers from `HarnessEngine`, so
 * the TUI renders pi's UX over durable state.
 *
 * pi's session is synchronous and the engine is not, so the adapter keeps a
 * snapshot: reads answer from it, writes go to the engine, and a watcher
 * refreshes it as commits land and forwards `entry_appended` to the TUI.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createExtensionRuntime, ExtensionRunner, type Extension } from "@earendil-works/pi-coding-agent";
import type { HarnessEngine } from "../engine.js";
import { projectEntry } from "../projection.js";
import { readFileSync } from "node:fs";
import { type SkillLike, type TemplateLike, expandPromptTemplate, expandSkillCommand } from "./slash.js";

const CONTEXT = BACKGROUND_CONTEXT;

type SessionEventListener = (event: unknown) => void;

export interface TuiAdapterOptions {
	readonly cwd: string;
	readonly sessionId: string;
	readonly settingsManager: unknown;
	readonly resourceLoader: unknown;
	readonly modelRuntime: unknown;
	readonly modelRegistry?: unknown;
	readonly thinkingLevel: string;
	/** pi's loaded extensions: their renderers and commands are what the TUI draws. */
	readonly extensions?: readonly Extension[];
	/** Whether the session is written to storage; pi asks this to print a resume hint. */
	readonly persisted?: boolean;
	/** Whether the session dir is the default one; pi asks this to shorten that hint. */
	readonly defaultSessionDir?: boolean;
	/** A terminal implementation; the process terminal when absent. */
	readonly terminal?: unknown;
}

export interface TuiRuntime {
	readonly cwd: string;
	readonly diagnostics: readonly unknown[];
	readonly modelFallbackMessage: string | undefined;
	readonly session: Record<string, unknown>;
	readonly sessionManager: Record<string, unknown>;
	readonly services: Record<string, unknown>;
	setRebindSession(callback?: (session: unknown) => Promise<void>): void;
	setBeforeSessionInvalidate(callback?: () => void): void;
	switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
	newSession(): Promise<{ cancelled: boolean }>;
	fork(entryId: string): Promise<{ cancelled: boolean; selectedText?: string }>;
	importFromJsonl(): Promise<{ cancelled: boolean }>;
	dispose(): Promise<void>;
	/** Read the durable state the synchronous getters answer from. */
	refresh(): Promise<void>;
	/** Forward durable commits to the TUI as `entry_appended`. */
	startWatching(): Promise<void>;
}

/** Build the runtime host pi's `InteractiveMode` takes. */
export function createTuiRuntime(engine: HarnessEngine, options: TuiAdapterOptions): TuiRuntime {
	const listeners = new Set<SessionEventListener>();
	let entries: readonly unknown[] = [];
	let messages: readonly unknown[] = [];
	let idle = true;
	// The registry's own model object, so pi's footer compares it like pi's own.
	let model: Record<string, unknown> | undefined;
	let extensionRunner: unknown;
	let extensionBindings: unknown;

	/** The runner the TUI reads for commands, renderers, and overlays. */
	function createRenderingRunner(): Record<string, unknown> {
		const empty = (): unknown[] => [];
		const none = (): undefined => undefined;
		return {
			// Commands and shortcuts the extensions registered for the TUI.
			getRegisteredCommands: empty,
			getCommand: none,
			getCommandDiagnostics: empty,
			getShortcuts: empty,
			getShortcutDiagnostics: empty,
			// Renderers: none until pi's runner is bound beside the host (task 6.1).
			resolveToolRenderers: empty,
			getToolRenderers: empty,
			getMessageRenderer: none,
			getMessageRenderers: empty,
			getEntryRenderer: none,
			getEntryRenderers: empty,
			getMarkdownTransformers: empty,
			getModelRegistry: none,
			getWidgets: empty,
			getKeybindings: empty,
			setUIContext: none,
			emitUserBash: none,
			emit: none,
			on: () => () => {},
			bind: none,
			dispose: none,
		};
	}

	/** pi expands `/skill:` and `/<template>` in its session; the host does it here. */
	const expand = (text: string): string => {
		if (!text.startsWith("/")) return text;
		const loader = options.resourceLoader as {
			getSkills?: () => { skills?: readonly SkillLike[] };
			getPrompts?: () => { prompts?: readonly TemplateLike[] };
		};
		return expandPromptTemplate(
			expandSkillCommand(text, loader.getSkills?.().skills ?? [], (path) => readFileSync(path, "utf8")),
			loader.getPrompts?.().prompts ?? [],
		);
	};

	const piEntries = (): unknown[] => entries.map((entry) => projectEntry(entry as never, null));
	const announce = (event: unknown): void => {
		for (const listener of listeners) listener(event);
	};

	const refresh = async (): Promise<void> => {
		const [nextEntries, nextMessages, quiescent, agent] = await Promise.all([
			engine.entries(),
			engine.messages(),
			engine.isQuiescent(),
			engine.resolvedAgent(),
		]);
		entries = nextEntries;
		messages = nextMessages;
		idle = quiescent;
		const registry = options.modelRuntime as { getModel?: (provider: string, id: string) => Record<string, unknown> | undefined };
		model =
			agent.model === undefined
				? undefined
				: (registry.getModel?.(agent.model.provider, agent.model.modelId) ?? {
						provider: agent.model.provider,
						id: agent.model.modelId,
						name: agent.model.modelId,
					});
	};

	const startWatching = async (): Promise<void> => {
		const stream = await engine.watchEvents();
		const seen = new Set(entries.map((entry) => String((entry as { readonly id: unknown }).id)));
		let wasRunning = false;
		stream.start((call) => {
			if (call.kind !== "value") return;
			const live = call.value.docs["pi.live"] as
				| { readonly run?: unknown; readonly generation?: unknown; readonly tools?: readonly Record<string, unknown>[] }
				| undefined;
			emitGeneration(live);
			for (const slot of live?.tools ?? []) emitTool(call.value, slot);
			const running = live?.run !== undefined;
			if (running !== wasRunning) {
				wasRunning = running;
				announce(running ? { type: "agent_start" } : { type: "agent_end", messages: [] });
			}
			const fresh = call.value.entries.filter((entry) => !seen.has(String(entry.id)));
			for (const entry of fresh) {
				seen.add(String(entry.id));
				announce({ type: "entry_appended", entry: projectEntry(entry, null) });
				// A message entry is announced as the message pair the TUI draws
				// (pi's AgentSessionEvent carries the message, not the entry).
				const message = (entry as { readonly model?: readonly { readonly role?: string }[] }).model?.[0];
				if (message !== undefined) {
					if (streaming !== undefined && message.role === "assistant") {
						// The streamed message landed: finalize it, do not draw it twice.
						streaming = undefined;
						streamingJson = "";
						announce({ type: "message_end", message });
					} else {
						announce({ type: "message_start", message });
						announce({ type: "message_end", message });
					}
				}
				emitControl(entry);
			}
			void refresh();
		});
	};

	/** pi's own runner, so extension rows, commands, and shortcuts are real (task 6.1). */
	const runner = (): unknown => {
		if (extensionRunner !== undefined) return extensionRunner;
		if (options.extensions === undefined || options.extensions.length === 0) {
			extensionRunner = createRenderingRunner();
			return extensionRunner;
		}
		extensionRunner = new ExtensionRunner(
			[...options.extensions],
			createExtensionRuntime(),
			options.cwd,
			sessionManager as never,
			(options.modelRegistry ?? options.modelRuntime) as never,
		);
		return extensionRunner;
	};

	/** The arguments of a model-issued call, from its assistant entry. */
	const toolArgs = (callId: string): unknown => {
		for (const entry of entries) {
			const message = (entry as { readonly model?: readonly { readonly content?: readonly { readonly type?: string; readonly id?: string; readonly arguments?: unknown }[] }[] }).model?.[0];
			for (const block of message?.content ?? []) {
				if (block.type === "toolCall" && block.id === callId) return block.arguments;
			}
		}
		return undefined;
	};

	/** Announce one tool slot as the start/update/end the TUI draws (task 5.1). */
	const startedTools = new Set<string>();
	// The generation's committed partial, and the calls its message already shows.
	let streaming: Record<string, unknown> | undefined;
	let streamingJson = "";
	const callsInGeneration = new Set<string>();

	/** Announce the in-flight assistant message as the pair the TUI streams (task 5.3). */
	const emitGeneration = (live: { readonly generation?: unknown } | undefined): void => {
		const message = (live?.generation as { readonly message?: Record<string, unknown> } | undefined)?.message;
		if (message === undefined) return;
		for (const block of (message.content as readonly { readonly type?: string; readonly id?: string }[] | undefined) ?? []) {
			if (block.type === "toolCall" && block.id !== undefined) callsInGeneration.add(block.id);
		}
		const json = JSON.stringify(message);
		if (streaming === undefined) {
			streaming = message;
			streamingJson = json;
			announce({ type: "message_start", message });
			return;
		}
		if (json !== streamingJson) {
			streamingJson = json;
			announce({ type: "message_update", message });
		}
	};
	const emitTool = (view: { readonly entries?: readonly unknown[] }, slot: Record<string, unknown>): void => {
		const callId = String(slot.callId);
		const name = String(slot.name ?? "");
		const status = slot.status;
		if (status === "pending" || status === "running") {
			// The TUI builds the row from the assistant's toolCall block, so wait for it
			// rather than draw a row with no arguments.
			if (!startedTools.has(callId) && !callsInGeneration.has(callId) && toolArgs(callId) === undefined) return;
			if (!startedTools.has(callId)) {
				startedTools.add(callId);
				announce({ type: "tool_execution_start", toolCallId: callId, toolName: name, args: toolArgs(callId) });
			}
			if (typeof slot.output === "string" && slot.output.length > 0) {
				announce({
					type: "tool_execution_update",
					toolCallId: callId,
					toolName: name,
					partialResult: { content: [{ type: "text", text: slot.output }], details: slot.details ?? {} },
				});
			}
			return;
		}
		if (status === "done" && startedTools.delete(callId)) {
			const result = (view.entries ?? [])
				.map((entry) => (entry as { readonly id?: unknown; readonly model?: readonly Record<string, unknown>[] }))
				.find((entry) => String(entry.id) === String(slot.entry))
				?.model?.[0];
			announce({
				type: "tool_execution_end",
				toolCallId: callId,
				toolName: name,
				result,
				isError: result?.isError === true,
				durationMs: result?.durationMs,
			});
		}
	};

	/** Announce a control entry as the event pi's TUI renders it (task 5.2). */
	const emitControl = (entry: unknown): void => {
		const control = entry as { readonly kind?: string; readonly data?: { readonly type?: string; readonly level?: string; readonly name?: string; readonly provider?: string; readonly modelId?: string } };
		if (control.kind !== "harness.control") return;
		switch (control.data?.type) {
			case "thinking_level_change":
				if (control.data.level !== undefined) announce({ type: "thinking_level_changed", level: control.data.level });
				return;
			case "session_info":
				announce({ type: "session_info_changed", name: control.data.name });
				return;
			default:
				return;
		}
	};

	// pi's footer reads the model from `state`, not from `session.model`.
	const sessionState = (): Record<string, unknown> => ({
		messages,
		...(model === undefined ? {} : { model }),
		thinkingLevel: engine.currentThinkingLevel() ?? options.thinkingLevel,
	});

	const sessionManager: Record<string, unknown> = {
		getEntries: () => piEntries(),
		getEntryCount: () => entries.length,
		getBranch: () => piEntries(),
		getTree: () => piEntries(),
		buildContextEntries: () => piEntries(),
		getLeafId: () => {
			const last = entries.at(-1) as { readonly id?: unknown } | undefined;
			return last?.id === undefined ? null : String(last.id);
		},
		// Identity comes from the engine, so the TUI and RPC agree (task 3.2).
		getSessionId: () => options.sessionId,
		getSessionName: () => undefined,
		// Durable keeps no session file: panels show identity, not a path.
		getSessionFile: () => undefined,
		getSessionDir: () => "",
		getCwd: () => options.cwd,
		isPersisted: () => options.persisted ?? true,
		usesDefaultSessionDir: () => options.defaultSessionDir ?? true,
		// A custom entry and a label are durable control entries (task 3.3).
		appendCustomEntry: (customType: string, data: unknown) =>
			engine.appendControl({ type: "custom", customType, data } as never),
		appendLabelChange: (_entryId: string, label: string) => engine.appendControl({ type: "label", label }),
	};

	const session: Record<string, unknown> = {
		sessionManager,
		sessionId: options.sessionId,
		sessionName: undefined,
		sessionFile: undefined,
		cwd: options.cwd,
		modelRuntime: options.modelRuntime,
		resourceLoader: options.resourceLoader,
		settingsManager: options.settingsManager,
		get extensionRunner() {
			return runner();
		},
		get state() {
			return sessionState();
		},
		get messages() {
			return messages;
		},
		get thinkingLevel() {
			return engine.currentThinkingLevel() ?? options.thinkingLevel;
		},
		get scopedModels() {
			return [];
		},
		// pi's loader owns the prompt templates; the TUI turns each into a `/name`
		// command and expands it, so an empty list makes every `/name` a raw prompt.
		get promptTemplates() {
			const loader = options.resourceLoader as { getPrompts?: () => { prompts?: readonly unknown[] } };
			return loader.getPrompts?.().prompts ?? [];
		},
		get isStreaming() {
			return !idle;
		},
		get isIdle() {
			return idle;
		},
		get isCompacting() {
			return false;
		},
		get isBashRunning() {
			return false;
		},
		get autoCompactionEnabled() {
			return true;
		},
		get retryAttempt() {
			return 0;
		},
		get model() {
			return model;
		},
		// pi sets this only for a virtual model, which routes every request. Durable
		// has none, and a value here makes the footer draw a bogus "old → new".
		get routedModel() {
			return undefined;
		},
		get agent() {
			return { state: {} };
		},
		getContextUsage: () => undefined,
		getAvailableThinkingLevels: () => ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
		getActiveToolNames: () => [...engine.declaredToolNames()],
		getCallableToolNames: () => [...engine.declaredToolNames()],
		getAllTools: () =>
			engine.allTools().map((tool) => ({ name: tool.name, description: tool.description ?? "", parameters: tool.parameters })),
		getToolDefinition: () => undefined,
		setActiveToolsByName: (names: readonly string[]) => {
			void engine.configure({ tools: engine.activeTools(names) } as never);
		},
		setModel: (model: { provider: string; id: string }) =>
			engine.configure({ model: { provider: model.provider, modelId: model.id } } as never),
		setThinkingLevel: (level: string) => engine.configure({ thinkingLevel: level } as never),
		setScopedModels: () => undefined,
		prompt: (text: string, submitOptions?: { readonly expandPromptTemplates?: boolean }) =>
			engine.submit(submitOptions?.expandPromptTemplates === false ? text : expand(text)),
		steer: (text: string) => engine.submit(expand(text), "steer"),
		followUp: (text: string) => engine.submit(expand(text), "followUp"),
		sendUserMessage: (content: string) => engine.submit(content),
		sendCustomMessage: () => undefined,
		abort: () => engine.abort(),
		clearQueue: () => undefined,
		getSteeringMessages: () => [],
		getFollowUpMessages: () => [],
		refreshContext: () => undefined,
		rename: () => undefined,
		navigateTree: () => undefined,
		// The TUI hands its bindings (ui context, mode, handlers) to the session; the
		// runner it later reads is ours, because the harness owns extension loading.
		bindExtensions: async (bindings: unknown) => {
			extensionBindings = bindings;
			const context = (bindings as { uiContext?: unknown; mode?: string } | undefined)?.uiContext;
			const target = runner() as { setUIContext?: (ui: unknown, mode?: string) => void };
			if (target.setUIContext !== undefined) target.setUIContext(context, "tui");
		},
		subscribe: (listener: SessionEventListener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose: () => undefined,
	};

	const services: Record<string, unknown> = {
		settingsManager: options.settingsManager,
		resourceLoader: options.resourceLoader,
		modelRuntime: options.modelRuntime,
		get extensionRunner() {
			return runner();
		},
	};

	return {
		cwd: options.cwd,
		diagnostics: [],
		modelFallbackMessage: undefined,
		session,
		sessionManager,
		services,
		setRebindSession: () => undefined,
		setBeforeSessionInvalidate: () => undefined,
		switchSession: async (sessionPath: string) => ({ cancelled: !(await engine.switchTo(sessionPath)) }),
		newSession: async () => {
			const created = await engine.newConversation();
			await engine.switchTo(String(created.id));
			return { cancelled: false };
		},
		fork: async (entryId: string) => ({
			cancelled: false,
			selectedText: String((await engine.fork(entryId)).conversationId),
		}),
		importFromJsonl: async () => ({ cancelled: true }),
		dispose: async () => {},
		refresh,
		startWatching,
	};
}
