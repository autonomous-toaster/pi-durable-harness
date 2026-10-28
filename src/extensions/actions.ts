/**
 * The durable-backed action surface for `pi.*` (extension API actions).
 *
 * The loader's factory receives a `pi` object whose action methods
 * (`sendMessage`, `appendEntry`, `getSessionId`, ...) delegate to a shared
 * `runtime`. Before pi's own `ExtensionRunner.bindCore()` those are throwing
 * stubs, and this harness never builds a runner: durable is the session store.
 * The `pi` closure resolves `runtime` at call time, so assigning real
 * implementations here makes those actions work without pi's session plumbing.
 *
 * An action with no durable equivalent keeps the loud stub, so a call fails
 * visibly instead of doing nothing.
 */
import type { ExtensionRuntime } from "@earendil-works/pi-coding-agent";
import type { HarnessEngine } from "../harness/engine.js";
import { projectEntries } from "../harness/projection.js";

/**
 * The actions an extension may call before the engine exists, such as a
 * `resources_discover` handler that inspects the command set. Installed before
 * discovery; the engine-backed surface replaces it afterwards.
 */
export function installPreludeActions(
	runtime: ExtensionRuntime,
	input: {
		readonly settings: () => unknown;
		readonly commands: () => readonly unknown[];
	},
): void {
	const target = runtime as unknown as Record<string, unknown>;
	target.getSettings = () => input.settings();
	target.getCommands = () => [...input.commands()];
}

/** Assign the actions the engine can honor; leave the rest as throwing stubs. */
export function installActions(runtime: ExtensionRuntime, engine: HarnessEngine): void {
	const target = runtime as unknown as Record<string, unknown>;

	/** A custom message becomes a durable submission on the next turn. */
	target.sendMessage = (message: { content?: unknown; customType?: string }, options?: { deliverAs?: string }) => {
		void engine.submit(message.content as never, options?.deliverAs === "followUp" ? "followUp" : "steer");
	};

	/** A user message is a plain submission. */
	target.sendUserMessage = (content: unknown, options?: { deliverAs?: string }) => {
		void engine.submit(content as never, options?.deliverAs === "followUp" ? "followUp" : "steer");
	};

	/** A custom entry is an append-only durable entry kind. */
	target.appendEntry = (customType: string, data?: unknown) => {
		void engine.appendControl({ type: "custom", customType, ...(data === undefined ? {} : { data }) } as never);
	};

	target.setSessionName = (name: string) => {
		void engine.appendControl({ type: "session_info", name } as never);
	};

	target.getSessionName = () => undefined;
	target.setLabel = () => {};

	target.getActiveTools = () => engine.declaredToolNames();
	target.getAllTools = () =>
		engine
			.allTools()
			.map((tool) => ({ name: tool.name, description: tool.description ?? "", parameters: tool.parameters }));
	target.setActiveTools = (names: string[]) => {
		void engine.configure({ tools: names } as never);
	};
	target.refreshTools = () => {};

	target.getSettings = () => engine.settingsManager.getSettings();
	target.getCommands = () => engine.commands().map((command) => ({ ...command }));

	target.setModel = async (model: { provider?: string; id?: string }) => {
		if (model?.provider === undefined || model?.id === undefined) return false;
		const found = engine.modelRuntime.getModel(model.provider, model.id);
		if (found === undefined) return false;
		await engine.configure({ model: { provider: model.provider, modelId: model.id } });
		return true;
	};

	target.getThinkingLevel = () => engine.currentThinkingLevel() ?? "off";
	target.setThinkingLevel = (level: string) => {
		void engine.configure({ thinkingLevel: level } as never);
	};
}

/** A synchronous view of the session, as pi's `sessionManager` offers. */
export interface SessionSnapshot {
	entries: unknown[];
	leafId: string | null;
	messages: unknown[];
	readonly ready: boolean;
}

/** A fresh, empty snapshot. */
export function emptySnapshot(): SessionSnapshot {
	return { entries: [], leafId: null, messages: [], ready: false };
}

/** Refresh `snapshot` from durable, so a handler reads it synchronously. */
export async function refreshSnapshot(engine: HarnessEngine, snapshot: SessionSnapshot): Promise<void> {
	try {
		const projected = projectEntries(await engine.entries());
		snapshot.entries = projected.entries;
		snapshot.leafId = projected.leafId;
		snapshot.messages = [...(await engine.messages())];
		(snapshot as { ready: boolean }).ready = true;
	} catch {
		// A refresh failure leaves the previous snapshot; handlers still run.
	}
}

/**
 * The `ctx.sessionManager` an extension handler reads. pi's manager is
 * synchronous, so this reads the snapshot the bus refreshes before each
 * dispatch instead of awaiting durable.
 */
export function createSessionManager(snapshot: SessionSnapshot, sessionId: string): Record<string, unknown> {
	return {
		getSessionId: () => sessionId,
		getSessionName: () => undefined,
		/** Durable is the session store, so there is no session file. */
		getSessionFile: () => null,
		getLeafId: () => snapshot.leafId,
		getBranch: () => snapshot.entries,
		getEntries: () => snapshot.entries,
		getMessages: () => snapshot.messages,
	};
}
