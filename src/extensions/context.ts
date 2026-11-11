/**
 * The context pi gives an extension, in one place (tasks 5.1-5.3).
 *
 * pi hands tools, commands, and session handlers the same `ExtensionContext`
 * shape. The harness built three different objects: tools got `{ cwd, hasUI,
 * ui }`, the event bus got a hardcoded `hasUI: true`, and commands and session
 * handlers got `{}` — so `ctx.ui.notify` threw and `ctx.sessionManager` was
 * missing. One factory removes the chance of the three drifting again.
 *
 * `hasUI` and `ui` are getters: a long-lived context stays accurate when a
 * client attaches or departs, while the session view and cwd are fixed when the
 * context is built.
 */
import { dialogMethods, hasUiClient } from "../rpc/ui-bridge.js";

/** `ctx.ui` for a context that expects pi's UI but has no client: every call is inert. */
export function inertUi(): Record<string, unknown> {
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

/** What an extension may read from its context; pi offers more, unhosted here. */
export interface ExtensionContextLike {
	readonly cwd: string;
	readonly mode: "rpc";
	readonly hasUI: boolean;
	readonly ui: Record<string, unknown>;
	readonly sessionManager: Record<string, unknown>;
}

export interface ExtensionContextOptions {
	readonly cwd: string | undefined;
	readonly sessionManager: Record<string, unknown>;
	/** Overrides the client probe, for a context built in a non-RPC mode. */
	readonly interactive?: boolean;
}

/** Build one extension context. */
export function createExtensionContext(options: ExtensionContextOptions): ExtensionContextLike {
	const interactive = (): boolean => options.interactive ?? hasUiClient();
	return {
		cwd: options.cwd ?? process.cwd(),
		mode: "rpc",
		get hasUI(): boolean {
			return interactive();
		},
		get ui(): Record<string, unknown> {
			return interactive() ? { ...inertUi(), ...dialogMethods() } : inertUi();
		},
		sessionManager: options.sessionManager,
	};
}

/**
 * The session view a context carries before a session exists. Reading it
 * answers pi's shape with nothing in it, rather than failing the extension.
 */
export function emptySessionManager(): Record<string, unknown> {
	return {
		getSessionId: () => "",
		getSessionName: () => undefined,
		getSessionFile: () => null,
		getLeafId: () => null,
		getBranch: () => [],
		getEntries: () => [],
		getMessages: () => [],
	};
}
