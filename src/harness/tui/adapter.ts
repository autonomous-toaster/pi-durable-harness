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
import { projectEntries, projectEntry } from "../projection.js";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { type SkillLike, type TemplateLike, expandPromptTemplate, expandSkillCommand } from "./slash.js";

const CONTEXT = BACKGROUND_CONTEXT;

type SessionEventListener = (event: unknown) => void;

export interface TuiAdapterOptions {
	readonly cwd: string;
	/** pi's agent directory: the trust store and other per-install state live there. */
	readonly agentDir?: string;
	readonly sessionId: string;
	readonly settingsManager: unknown;
	readonly resourceLoader: unknown;
	readonly modelRuntime: unknown;
	readonly modelRegistry?: unknown;
	readonly thinkingLevel: string;
	/** Whether the project is trusted, asked again by `/reload`. */
	readonly resolveProjectTrust?: () => boolean;
	/** Re-read MCP servers, so `/reload` sees a server added or removed. */
	readonly reloadMcp?: () => Promise<void>;
	/** pi's loaded extensions: their renderers and commands are what the TUI draws. */
	readonly extensions?: readonly Extension[];
	/** Whether the session is written to storage; pi asks this to print a resume hint. */
	readonly persisted?: boolean;
	/** Whether the session dir is the default one; pi asks this to shorten that hint. */
	readonly defaultSessionDir?: boolean;
	/** Where this session lives, as `/session` shows it (a path, or the database). */
	readonly sessionFile?: string;
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
	let poller: ReturnType<typeof setInterval> | undefined;
	let lastAssistant: string | undefined;
	/** Messages awaiting delivery, which escape returns to the editor. */
	let steeringQueue: string[] = [];
	let followQueue: string[] = [];
	/** Renderers that live with pi's built-in tools (codemode), loaded from pi's own files. */
	let builtinRenderers: Record<string, Record<string, unknown>> = {};
	/** Turn counter already announced, so the working spinner starts once per turn. */
	let announcedTurn = -1;
	let retryAnnounced = false;
	let compacting = new Set<string>();
	let settledAnnounced = false;
	/** The models startup lists as "Model scope" and Ctrl+P cycles. */
	let scoped: { model: Record<string, unknown>; thinkingLevel?: string }[] = [];
	let bashProcess: ReturnType<typeof spawn> | undefined;
	/** The session file pi prints and /session shows. */
	const sessionFileOf = (): string | undefined => options.sessionFile;
	let extensionRunner: unknown;
	/** Extensions the loader found at the last reload, when it differs from startup. */
	let freshExtensions: readonly Extension[] | undefined;
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
			// pi's own fallback is what draws bash, read, edit, and write.
			resolveToolRenderers: (_name: string, fallback?: () => unknown) => fallback?.(),
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

	/**
	 * Run `/<extension-command> args` through pi's runner (pi's own
	 * `_tryExecuteExtensionCommand`): without this, `/plannotator-last` is sent to the
	 * model as a prompt instead of running the command.
	 */
	const runExtensionCommand = async (text: string): Promise<boolean> => {
		if (!text.startsWith("/")) return false;
		const space = text.indexOf(" ");
		const name = space === -1 ? text.slice(1) : text.slice(1, space);
		const args = space === -1 ? "" : text.slice(space + 1);
		const target = runner() as {
			getCommand?: (name: string) => { handler?: (args: string, context: unknown) => Promise<void> | void } | undefined;
			createCommandContext?: () => unknown;
			emitError?: (details: unknown) => void;
		};
		const command = target.getCommand?.(name);
		if (command?.handler === undefined) return false;
		try {
			await command.handler(args, target.createCommandContext?.());
		} catch (error) {
			target.emitError?.({ extensionPath: `command:${name}`, event: "command", error: String(error) });
		}
		return true;
	};

	/**
	 * pi's session tree: root nodes, each with the entries beneath it. The label and
	 * its timestamp come from the label control entries, as in pi's own manager.
	 */
	const buildTree = (list: readonly unknown[]): unknown[] => {
		type Node = { entry: unknown; children: Node[]; label?: string; labelTimestamp?: string };
		const nodes = new Map<string, Node>();
		const roots: Node[] = [];
		for (const entry of list) nodes.set(String((entry as { id: unknown }).id), { entry, children: [] });
		for (const entry of list) {
			const typed = entry as { readonly id: unknown; readonly parentId?: unknown };
			const node = nodes.get(String(typed.id));
			if (node === undefined) continue;
			const parent = typed.parentId == null ? undefined : nodes.get(String(typed.parentId));
			if (parent === undefined || String(typed.parentId) === String(typed.id)) roots.push(node);
			else parent.children.push(node);
		}
		for (const entry of list) {
			const typed = entry as { readonly type?: string; readonly label?: string; readonly targetId?: unknown; readonly timestamp?: string };
			if (typed.type !== "label" || typed.label === undefined) continue;
			const target = typed.targetId === undefined ? undefined : nodes.get(String(typed.targetId));
			// A control entry without a target labels the entry before it, as pi does.
			const node = target ?? nodes.get(String((list[list.indexOf(entry) - 1] as { readonly id?: unknown } | undefined)?.id));
			if (node !== undefined) {
				node.label = typed.label;
				if (typed.timestamp !== undefined) node.labelTimestamp = typed.timestamp;
			}
		}
		return roots;
	};

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

	/**
	 * The transcript as pi's session entries. Each one carries its predecessor as
	 * `parentId`: pi walks that chain to render history, and a null parent on every
	 * entry leaves it with the leaf alone — the last message and nothing before it.
	 */
	const piEntries = (): unknown[] => projectEntries(entries as never).entries;
	/** One entry as pi would see it, with the predecessor it hangs from. */
	const projectedOf = (entry: unknown): unknown => {
		const all = projectEntries(entries as never).entries as readonly { readonly id?: unknown }[];
		return all.find((candidate) => String(candidate.id) === String((entry as { readonly id?: unknown }).id)) ?? projectEntry(entry as never, null);
	};

	const announce = (event: unknown): void => {
		for (const listener of listeners) listener(event);
	};

	/**
	 * pi's codemode renderer is not a core renderer: it lives beside the codemode
	 * extension and is not re-exported. The pinned version makes its path stable, and a
	 * failure falls back to the generic tool row rather than breaking the TUI.
	 */
	const loadBuiltinRenderers = async (): Promise<void> => {
		if (Object.keys(builtinRenderers).length > 0) return;
		try {
			const base = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
			const module = (await import(new URL("extensions/codemode/renderer.js", base).href)) as {
				readonly codemodeRenderers?: Record<string, unknown>;
			};
			if (module.codemodeRenderers !== undefined) builtinRenderers = { codemode: module.codemodeRenderers };
		} catch {
			builtinRenderers = {};
		}
	};

	const refresh = async (): Promise<void> => {
		await loadBuiltinRenderers();
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
		lastAssistant = (await engine.lastAssistantText?.()) ?? lastAssistant;
		if (scoped.length === 0) {
			// pi's header lists `enabledModels`, not every model with credentials.
			const settings = options.settingsManager as { getEnabledModels?: () => readonly string[] };
			const registry = options.modelRuntime as { getModel?: (provider: string, id: string) => Record<string, unknown> | undefined };
			scoped = (settings.getEnabledModels?.() ?? []).flatMap((entry) => {
				const slash = entry.indexOf("/");
				if (slash === -1) return [];
				const model = registry.getModel?.(entry.slice(0, slash), entry.slice(slash + 1));
				return model === undefined ? [] : [{ model }];
			});
		}
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
		// The durable stream is a hint: a revision it does not deliver would leave the
		// transcript behind, so the view is also read on a timer.
		const seen = new Set(entries.map((entry) => String((entry as { readonly id: unknown }).id)));
		let wasRunning = false;
		const apply = (view: {
			readonly entries?: readonly unknown[];
			readonly docs?: { readonly "pi.live"?: unknown };
		}): void => {
			try {
				const live = view.docs?.["pi.live"] as
					| {
							readonly run?: unknown;
							readonly generation?: unknown;
							readonly tools?: readonly Record<string, unknown>[];
							readonly compactions?: readonly Record<string, unknown>[];
						}
					| undefined;
				emitGeneration(live);
				for (const slot of live?.tools ?? []) emitTool(view, slot);
				const run = live?.run as { readonly turns?: number } | undefined;
				const running = run !== undefined;
				if (running !== wasRunning && running) {
					wasRunning = true;
					settledAnnounced = false;
					announce({ type: "agent_start" });
				}
				// A turn shows pi's working indicator and its terminal progress.
				if (running && (run?.turns ?? 0) > announcedTurn) {
					announcedTurn = run?.turns ?? 0;
					announce({ type: "turn_start" });
				}
				emitRetries(live);
				emitCompactions(live);
				for (const entry of view.entries ?? []) {
					if (seen.has(String((entry as { readonly id: unknown }).id))) continue;
					seen.add(String((entry as { readonly id: unknown }).id));
					announce({ type: "entry_appended", entry: projectedOf(entry) });
					// A message entry is announced as the message pair the TUI draws
					// (pi's AgentSessionEvent carries the message, not the entry).
					const message = (entry as { readonly model?: readonly { readonly role?: string }[] }).model?.[0];
					if (message !== undefined) {
						noteToolCalls(message);
						if (streaming !== undefined && message.role === "assistant") {
							// The streamed message landed: finalize it, do not draw it twice.
							finalisedGeneration = streamingJson;
							streaming = undefined;
							streamingJson = "";
							announce({ type: "message_end", message });
						} else {
							announce({ type: "message_start", message });
							// pi draws a call's row from message_update alone, so a committed
							// message carrying calls is announced that way too.
							if (hasToolCalls(message)) announce({ type: "message_update", message });
							announce({ type: "message_end", message });
						}
					}
					emitControl(entry as never);
				}
				// pi's agent_end discards the streaming component, so it is announced only
				// after the run's messages landed; otherwise the answer is wiped on arrival.
				if (running !== wasRunning) {
					wasRunning = running;
					announcedTurn = -1;
					// The run drained whatever was queued for it.
					steeringQueue = [];
					followQueue = [];
					announce({ type: "agent_end", messages: [] });
					announce({ type: "queue_update" });
				}
			} catch {
				// One malformed view must not stop the transcript for the rest of the session.
			}
		};
		let signature = "";
		const read = async (): Promise<void> => {
			const view = await engine.view();
			// Nothing new means nothing to repaint; polling unconditionally made the TUI
			// redraw its whole chat five times a second.
			const entries = view.entries ?? [];
			const next = `${entries.length}|${String((entries.at(-1) as { readonly id?: unknown } | undefined)?.id ?? "")}|${JSON.stringify(view.docs?.["pi.live"] ?? null).length}`;
			if (next === signature) return;
			signature = next;
			apply(view);
			// The synchronous getters answer from this snapshot, so it is refreshed with
			// every read; without it the footer counters and /session stats stay empty.
			await refresh();
			// pi flushes deferred bash results and checks a pending shutdown on this event.
			if (idle && !settledAnnounced && !wasRunning) {
				settledAnnounced = true;
				announce({ type: "agent_settled" });
			}
		};
		stream.start((call) => {
			if (call.kind !== "value") return;
			apply(call.value);
			void read().catch(() => {});
		});
		poller = setInterval(() => {
			void read().catch(() => {});
		}, 200);
		// The view poll must never be what keeps the process alive.
		poller.unref?.();
	};

	/** pi's own runner, so extension rows, commands, and shortcuts are real (task 6.1). */
	const runner = (): unknown => {
		if (extensionRunner !== undefined) return extensionRunner;
		const extensions = freshExtensions ?? options.extensions;
		if (extensions === undefined || extensions.length === 0) {
			extensionRunner = createRenderingRunner();
			return extensionRunner;
		}
		extensionRunner = new ExtensionRunner(
			[...extensions],
			createExtensionRuntime(),
			options.cwd,
			sessionManager as never,
			(options.modelRegistry ?? options.modelRuntime) as never,
		);
		return extensionRunner;
	};

	/** The arguments of a model-issued call, from its assistant entry. */
	const toolArgs = (callId: string): unknown => {
		for (const block of (partial?.content as readonly { readonly type?: string; readonly id?: string; readonly arguments?: unknown }[] | undefined) ?? []) {
			if (block.type === "toolCall" && block.id === callId) return block.arguments;
		}
		for (const entry of entries) {
			const message = (entry as { readonly model?: readonly { readonly content?: readonly { readonly type?: string; readonly id?: string; readonly arguments?: unknown }[] }[] }).model?.[0];
			for (const block of message?.content ?? []) {
				if (block.type === "toolCall" && block.id === callId) return block.arguments;
			}
		}
		return undefined;
	};

	/** Durable retry backoff, drawn as pi's retry indicator with its attempt and delay. */
	const emitRetries = (live: { readonly generation?: unknown } | undefined): void => {
		const retry = (live?.generation as { readonly retry?: { readonly at: number; readonly error: string } } | undefined)?.retry;
		if (retry !== undefined && !retryAnnounced) {
			retryAnnounced = true;
			announce({
				type: "auto_retry_start",
				attempt: 1,
				maxAttempts: 5,
				delayMs: Math.max(0, retry.at - Date.now()),
				errorMessage: retry.error,
			});
			return;
		}
		if (retry === undefined && retryAnnounced) {
			retryAnnounced = false;
			announce({ type: "auto_retry_end", success: true, attempt: 1 });
		}
	};

	/** Durable compaction tasks, drawn as pi's compaction status; escape aborts them. */
	const emitCompactions = (live: { readonly compactions?: readonly Record<string, unknown>[] } | undefined): void => {
		const now = new Set((live?.compactions ?? []).map((task) => String(task.taskId)));
		for (const id of now) {
			if (compacting.has(id)) continue;
			compacting.add(id);
			const trigger = (live?.compactions ?? []).find((task) => String(task.taskId) === id)?.trigger;
			announce({ type: "compaction_start", reason: trigger === "threshold" || trigger === "overflow" ? trigger : "manual" });
		}
		for (const id of [...compacting]) {
			if (now.has(id)) continue;
			compacting.delete(id);
			announce({ type: "compaction_end", reason: "manual", result: undefined, aborted: false, willRetry: false });
		}
	};

	/** The text of a message's content, for the editor after a rewind. */
	const textOfContent = (content: unknown): string => {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return content
			.flatMap((block) => ((block as { readonly type?: string }).type === "text" ? [(block as { readonly text?: string }).text ?? ""] : []))
			.join("");
	};

	/** Announce one tool slot as the start/update/end the TUI draws (task 5.1). */
	const hasToolCalls = (message: unknown): boolean =>
		((message as { readonly content?: unknown })?.content as readonly { readonly type?: string }[] | undefined)?.some?.(
			(block) => block.type === "toolCall",
		) === true;

	/** Call ids whose row pi has already been given, from a message it draws. */
	const rowsCreated = new Set<string>();
	const noteToolCalls = (message: unknown): void => {
		for (const block of ((message as { readonly content?: unknown })?.content as readonly { readonly type?: string; readonly id?: string }[] | undefined) ?? []) {
			if (block.type === "toolCall" && block.id !== undefined) rowsCreated.add(block.id);
		}
	};

	const startedTools = new Set<string>();
	const finishedTools = new Set<string>();
	// The generation's committed partial, and the calls its message already shows.
	let streaming: Record<string, unknown> | undefined;
	/** The newest in-flight assistant message: the only place a running call's arguments exist. */
	let partial: Record<string, unknown> | undefined;
	let streamingJson = "";
	/** The generation already drawn and finalized, so a lingering partial is not redrawn. */
	let finalisedGeneration = "";
	const callsInGeneration = new Set<string>();

	/** Announce the in-flight assistant message as the pair the TUI streams (task 5.3). */
	const emitGeneration = (live: { readonly generation?: unknown } | undefined): void => {
		const message = (live?.generation as { readonly message?: Record<string, unknown> } | undefined)?.message;
		if (message === undefined) return;
		for (const block of (message.content as readonly { readonly type?: string; readonly id?: string }[] | undefined) ?? []) {
			if (block.type === "toolCall" && block.id !== undefined) callsInGeneration.add(block.id);
		}
		partial = message;
		const json = JSON.stringify(message);
		if (json === finalisedGeneration) return;
		if (streaming === undefined) {
			streaming = message;
			streamingJson = json;
			// pi builds a tool row from message_update, not message_start, so the first
			// partial is announced both ways: without it a call draws with no arguments.
			noteToolCalls(message);
			announce({ type: "message_start", message });
			announce({ type: "message_update", message });
			return;
		}
		if (json !== streamingJson) {
			streamingJson = json;
			announce({ type: "message_update", message });
		}
	};
	const emitTool = (view: { readonly entries?: readonly unknown[] }, slot: Record<string, unknown>): void => {
		// The durable call id is the model's own, so pi keys the row and the slot alike.
		const callId = String(slot.callId);
		const name = String(slot.name ?? "");
		const status = slot.status;
		if (status === "pending" || status === "running") {
			if (!startedTools.has(callId)) {
				// The row exists only once a message carrying the call was drawn; starting
				// it earlier gives pi a row with no arguments.
				if (!rowsCreated.has(callId)) return;
				startedTools.add(callId);
				finishedTools.delete(callId);
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
		if (status === "done") {
			// The view is polled, so a settled call is announced exactly once.
			if (finishedTools.has(callId)) return;
			finishedTools.add(callId);
			startedTools.delete(callId);
			// A call whose row exists is only settled; one that never showed still needs
			// a row to settle, built from the committed entry's arguments.
			if (!rowsCreated.has(callId)) {
				announce({ type: "tool_execution_start", toolCallId: callId, toolName: name, args: toolArgs(callId) });
			}
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
		// The tree selector walks `children`, so a root node list with empty arrays is
		// what it needs; a flat entry list crashed it on the first double escape.
		getTree: () => buildTree(piEntries()),
		// The branch from root to leaf, which is the context the model sees.
		buildContextEntries: () => {
			const list = piEntries();
			const byId = new Map<string, Record<string, unknown>>(list.map((entry) => [String((entry as { id: unknown }).id), entry as Record<string, unknown>]));
			const path: Record<string, unknown>[] = [];
			let cursor = list.at(-1) as { readonly id?: unknown; readonly parentId?: unknown } | undefined;
			const seen = new Set<string>();
			while (cursor?.id !== undefined && !seen.has(String(cursor.id))) {
				seen.add(String(cursor.id));
				const entry = byId.get(String(cursor.id));
				if (entry !== undefined) path.push(entry);
				const parentId = entry?.parentId as string | null | undefined;
				cursor = parentId == null ? undefined : (byId.get(String(parentId)) as { readonly id?: unknown; readonly parentId?: unknown } | undefined);
			}
			return path.reverse();
		},
		getLeafId: () => {
			const last = entries.at(-1) as { readonly id?: unknown } | undefined;
			return last?.id === undefined ? null : String(last.id);
		},
		// Identity comes from the engine, so the TUI and RPC agree (task 3.2).
		getSessionId: () => options.sessionId,
		getSessionName: () => undefined,
		// Durable keeps no session file: panels show identity, not a path.
		getSessionFile: () => sessionFileOf(),
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
			return scoped;
		},
		// --- the rest of pi's AgentSession surface (tools/tui-surface.mjs lists it) ---

		/** pi's /session aggregates usage over every entry, compacted history included. */
		getSessionStats() {
			const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
			const add = (usage: Record<string, number> | undefined): void => {
				if (usage === undefined) return;
				totals.input += usage.input ?? 0;
				totals.output += usage.output ?? 0;
				totals.cacheRead += usage.cacheRead ?? 0;
				totals.cacheWrite += usage.cacheWrite ?? 0;
				totals.cost += (usage as { cost?: { total?: number } }).cost?.total ?? 0;
			};
			let userMessages = 0;
			let assistantMessages = 0;
			let toolResults = 0;
			let totalMessages = 0;
			let toolCalls = 0;
			// Usage rides on the messages, not on the durable entry records.
			for (const message of messages as readonly Record<string, unknown>[]) {
				if (message === undefined) continue;
				totalMessages++;
				if (message.role === "user") userMessages++;
				else if (message.role === "toolResult") {
					toolResults++;
					add(message.usage as Record<string, number> | undefined);
				} else if (message.role === "assistant") {
					assistantMessages++;
					const content = message.content;
					if (Array.isArray(content)) toolCalls += content.filter((part) => (part as { type?: string }).type === "toolCall").length;
					add(message.usage as Record<string, number> | undefined);
				}
			}
			return {
				sessionFile: sessionFileOf(),
				sessionId: options.sessionId,
				userMessages,
				assistantMessages,
				toolCalls,
				toolResults,
				totalMessages,
				tokens: {
					input: totals.input,
					output: totals.output,
					cacheRead: totals.cacheRead,
					cacheWrite: totals.cacheWrite,
					total: totals.input + totals.output + totals.cacheRead + totals.cacheWrite,
				},
				cost: totals.cost,
				contextUsage: undefined,
			};
		},
		/** pi's fork picker lists the prompts a user could fork from. */
		getUserMessagesForForking() {
			const result: { entryId: string; text: string }[] = [];
			for (const entry of entries) {
				const message = (entry as { readonly id: unknown; readonly model?: readonly Record<string, unknown>[] }).model?.[0];
				if (message?.role !== "user") continue;
				const content = message.content;
				const text = typeof content === "string" ? content : Array.isArray(content) ? content.flatMap((part) => ((part as { type?: string }).type === "text" ? [(part as { text?: string }).text ?? ""] : [])).join("") : "";
				if (text.length > 0) result.push({ entryId: String((entry as { readonly id: unknown }).id), text });
			}
			return result;
		},
		getLastAssistantText: () => lastAssistant,
		get pendingMessageCount() {
			return 0;
		},
		async waitForIdle() {
			while (!(await engine.isQuiescent())) await new Promise((resolve) => setTimeout(resolve, 100));
		},
		get systemPrompt() {
			const loader = options.resourceLoader as { getSystemPrompt?: () => string | undefined };
			return loader.getSystemPrompt?.() ?? "";
		},
		get steeringMode() {
			return (options.settingsManager as { getSteeringMode?: () => string }).getSteeringMode?.() ?? "interrupt";
		},
		get followUpMode() {
			return (options.settingsManager as { getFollowUpMode?: () => string }).getFollowUpMode?.() ?? "queue";
		},
		setSteeringMode(mode: string) {
			(options.settingsManager as { setSteeringMode?: (mode: string) => void }).setSteeringMode?.(mode);
		},
		setFollowUpMode(mode: string) {
			(options.settingsManager as { setFollowUpMode?: (mode: string) => void }).setFollowUpMode?.(mode);
		},
		setSessionName(name: string) {
			void engine.appendControl({ type: "session_info", name } as never);
		},
		setAutoCompactionEnabled(enabled: boolean) {
			(options.settingsManager as { setAutoCompact?: (enabled: boolean) => void }).setAutoCompact?.(enabled);
		},
		setCacheWarmingMode(mode: string) {
			(options.settingsManager as { setCacheWarmingMode?: (mode: string) => void }).setCacheWarmingMode?.(mode);
		},
		get cacheWarmingStatus() {
			return undefined;
		},
		/** Durable compacts through its own task; the TUI only needs to ask. */
		// pi hands this result to the caller's onComplete, so the value has to travel.
		async compact(instructions?: string) {
			return await engine.compact?.(instructions);
		},
		abortCompaction: () => undefined,
		abortBranchSummary: () => undefined,
		abortRetry: () => undefined,
		async reload() {
			const loader = options.resourceLoader as {
				reload?: (options: unknown) => Promise<void>;
				getAgentsFiles?: () => { agentsFiles?: readonly unknown[] };
				getSkills?: () => { skills?: readonly unknown[] };
				getPrompts?: () => { prompts?: readonly unknown[] };
				getSystemPrompt?: () => string | undefined;
				getAppendSystemPrompt?: () => readonly string[];
				getExtensions?: () => { extensions?: readonly unknown[] };
			};
			// pi re-reads everything the loader owns, with the project's trust as it stands.
			await loader.reload?.({ resolveProjectTrust: async () => options.resolveProjectTrust?.() ?? true });
			await options.reloadMcp?.();
			engine.applyResources({
				...(loader.getAgentsFiles?.().agentsFiles === undefined ? {} : { agentsFiles: loader.getAgentsFiles?.().agentsFiles as never }),
				...(loader.getSkills?.().skills === undefined ? {} : { skills: loader.getSkills?.().skills as never }),
				...(loader.getPrompts?.().prompts === undefined ? {} : { prompts: loader.getPrompts?.().prompts as never }),
				...(loader.getSystemPrompt?.() === undefined ? {} : { systemPrompt: loader.getSystemPrompt?.() }),
				...(loader.getAppendSystemPrompt?.() === undefined ? {} : { appendSystemPrompt: loader.getAppendSystemPrompt?.() as never }),
			});
			// Extensions are rebuilt from what the loader found this time, not the startup list.
			const refreshed = loader.getExtensions?.().extensions;
			if (refreshed !== undefined) {
				extensionRunner = undefined;
				freshExtensions = refreshed as never;
			}
			await refresh();
		},
		/**
		 * pi writes the file and returns its path, which the TUI prints. Returning the
		 * HTML itself made `/export` print a document and write nothing.
		 */
		async exportToHtml(outputPath?: string, _options?: { readonly themeName?: string }) {
			const html = await engine.exportHtml();
			const path = outputPath === undefined
				? join(process.cwd(), `pi-durable-session-${options.sessionId}.html`)
				: resolve(process.cwd(), outputPath);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, html, "utf8");
			return path;
		},
		/** The same contract as pi's: write a JSONL file and answer its path. */
		async exportToJsonl(outputPath?: string) {
			const lines = entries.map((entry) => JSON.stringify(projectEntry(entry as never, null))).join("\n");
			const path = outputPath === undefined
				? resolve(process.cwd(), `session-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.jsonl`)
				: resolve(process.cwd(), outputPath);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, `${lines}\n`, "utf8");
			return path;
		},
		async cycleModel() {
			const models = (await engine.availableModels?.()) ?? [];
			if (models.length === 0) return false;
			const current = (await engine.resolvedAgent()).model;
			const index = models.findIndex((model) => model.provider === current?.provider && model.id === current?.modelId);
			const next = models[(index + 1) % models.length];
			if (next === undefined) return false;
			await engine.configure({ model: { provider: next.provider, modelId: next.id } });
			await refresh();
			return true;
		},
		async cycleThinkingLevel() {
			const capability = engine as unknown as { getAvailableThinkingLevels?: () => readonly string[] };
			const levels = capability.getAvailableThinkingLevels?.() ?? ["off", "low", "medium", "high"];
			const current = engine.currentThinkingLevel() ?? "off";
			const next = levels[(levels.indexOf(current) + 1) % levels.length];
			await engine.configure({ thinkingLevel: next } as never);
			await refresh();
			return next;
		},
		/** The TUI's `!command` runs in the session's cwd, as pi's does. */
		async executeBash(command: string, onChunk?: (chunk: string) => void) {
			const settings = options.settingsManager as { getShellPath?: () => string | undefined; getShellCommandPrefix?: () => string | undefined };
			const shell = settings.getShellPath?.() ?? process.env.SHELL ?? "/bin/sh";
			const prefix = settings.getShellCommandPrefix?.();
			const script = prefix === undefined ? command : `${prefix}\n${command}`;
			const child = spawn(shell, ["-c", script], { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
			bashProcess = child;
			let output = "";
			const collect = (chunk: Buffer): void => {
				const text = chunk.toString();
				output += text;
				onChunk?.(text);
			};
			child.stdout?.on("data", collect);
			child.stderr?.on("data", collect);
			const exitCode = await new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 0)));
			bashProcess = undefined;
			return { output, exitCode };
		},
		abortBash() {
			bashProcess?.kill();
			bashProcess = undefined;
		},
		recordBashResult: () => undefined,

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
		getToolDefinition: (name: string) => {
			const definition = (engine.allTools() as readonly Record<string, unknown>[]).find((tool) => tool.name === name);
			if (definition === undefined) return undefined;
			// pi merges its built-in renderers itself; a tool whose renderer lives in a
			// built-in extension (codemode) needs them here or it draws as an unknown tool.
			return { ...definition, ...(builtinRenderers[name] ?? {}) };
		},
		setActiveToolsByName: (names: readonly string[]) => {
			void engine.configure({ tools: engine.activeTools(names) } as never);
		},
		setModel: (model: { provider: string; id: string }) =>
			engine.configure({ model: { provider: model.provider, modelId: model.id } } as never),
		setThinkingLevel: (level: string) => engine.configure({ thinkingLevel: level } as never),
		setScopedModels: (models: { model: Record<string, unknown>; thinkingLevel?: string }[]) => {
			scoped = models;
		},
		// pi's prompt() resolves when the run settles, and that await is what drives the
		// durable run: a dropped submission leaves it pending at turn 0.
		prompt: async (text: string, submitOptions?: { readonly expandPromptTemplates?: boolean }) => {
			// pi dispatches an extension command before anything reaches the model.
			if (submitOptions?.expandPromptTemplates !== false && (await runExtensionCommand(text))) return;
			await engine.submitAndWait(submitOptions?.expandPromptTemplates === false ? text : expand(text));
		},
		steer: async (text: string) => {
			if (await runExtensionCommand(text)) return;
			// Queued, not awaited: pi's steer() returns while the run keeps going.
			steeringQueue.push(expand(text));
			announce({ type: "queue_update" });
			await engine.submit(expand(text), "steer");
		},
		followUp: async (text: string) => {
			if (await runExtensionCommand(text)) return;
			followQueue.push(expand(text));
			announce({ type: "queue_update" });
			await engine.submit(expand(text), "followUp");
		},
		sendUserMessage: async (content: string) => {
			await engine.submitAndWait(content);
		},
		sendCustomMessage: () => undefined,
		abort: () => engine.abort(),
		// pi destructures this on escape: the pending messages come back to the editor.
		clearQueue: () => ({ steering: [...steeringQueue], followUp: [...followQueue] }),
		getSteeringMessages: () => steeringQueue,
		getFollowUpMessages: () => followQueue,
		refreshContext: () => undefined,
		rename: () => undefined,
		/**
		 * pi moves the leaf: a user message rewinds to *before* it and hands its text
		 * back to the editor; anything else rewinds to itself. Durable has no leaf, so
		 * the session continues in a fork of the conversation at that point, and the
		 * pointer written beside the session makes a restart resume there.
		 */
		navigateTree: async (targetId: string, options?: { readonly summarize?: boolean }) => {
			// A branch summary is pi's; durable has none, so the request is refused
			// rather than silently performed without one.
			if (options?.summarize === true) return { cancelled: false, aborted: true };
			const list = piEntries() as readonly {
				readonly id?: unknown;
				readonly parentId?: unknown;
				readonly type?: string;
				readonly message?: { readonly role?: string; readonly content?: unknown };
			}[];
			const target = list.find((entry) => String(entry.id) === String(targetId));
			if (target === undefined) return { cancelled: true };
			const isUser = target.type === "message" && target.message?.role === "user";
			const at = isUser ? (target.parentId == null ? null : String(target.parentId)) : String(targetId);
			await engine.rewind(at);
			await refresh();
			return {
				cancelled: false,
				...(isUser ? { editorText: textOfContent(target.message?.content) } : {}),
			};
		},
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
		dispose: async () => {
			if (poller !== undefined) clearInterval(poller);
			poller = undefined;
		},
	};

	const services: Record<string, unknown> = {
		// /trust builds a ProjectTrustStore from this, so an undefined path crashes it.
		agentDir: options.agentDir ?? join(homedir(), ".pi", "agent"),
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
		// A new conversation, recorded as the one the session continues in — the same
		// pointer a rewind writes, or a restart would fall back to the first one.
		newSession: async () => {
			await engine.rewind(null);
			await refresh();
			return { cancelled: false };
		},
		// pi puts the text of the forked message back in the editor, so a conversation id
		// there filled the editor with a hash.
		fork: async (entryId: string) => {
			const target = (piEntries() as readonly { readonly id?: unknown; readonly message?: { readonly content?: unknown } }[]).find(
				(entry) => String(entry.id) === String(entryId),
			);
			await engine.rewind(String(entryId));
			await refresh();
			return { cancelled: false, selectedText: textOfContent(target?.message?.content) };
		},
		importFromJsonl: async () => ({ cancelled: true }),
		dispose: async () => {},
		refresh,
		startWatching,
	};
}
