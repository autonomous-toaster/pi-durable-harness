/**
 * Extension event dispatch.
 *
 * pi extensions subscribe with `pi.on(name, handler)`. The loader records those
 * handlers; this bus calls them at the point the harness already reaches: the
 * projected session-event stream, the RPC command handlers, and session close.
 * Handlers run in registration order and are serialized, so an extension sees
 * events in the order the session produced them.
 */
import type { Extension as PiExtension } from "@earendil-works/pi-coding-agent";

/** The `ctx` pi passes to an event handler, reduced to what an RPC host can offer. */
export interface EventContext {
	readonly cwd: string;
	readonly mode: "rpc";
	readonly hasUI: true;
	readonly ui: Record<string, unknown>;
	/** Read-only session view, as `ctx.sessionManager` in pi. */
	readonly sessionManager: Record<string, unknown>;
}

type Handler = (event: unknown, ctx: unknown) => unknown;

/** One unapplied handler result, reported instead of silently dropped. */
export interface IgnoredResult {
	readonly extension: string;
	readonly event: string;
	readonly field: string;
}

/** Events the harness dispatches. Every other subscribed name is reported. */
export const DISPATCHED_EVENTS: ReadonlySet<string> = new Set([
	"before_agent_start",
	"agent_start",
	"agent_end",
	"agent_before_settle",
	"agent_settled",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"session_start",
	"session_info_changed",
	"session_compact",
	"session_compact_failed",
	"session_shutdown",
	"session_tree",
	"model_select",
	"thinking_level_select",
	"user_bash",
	"input",
	"resources_discover",
]);

/**
 * Events pi itself reduces to nothing in RPC mode, because they need a terminal.
 * The harness accepts the subscription and never reports it: matching pi, where
 * these registrations load and simply have no effect.
 */
export const INERT_EVENTS: ReadonlySet<string> = new Set(["ui_prompt_start", "ui_prompt_end"]);

export class ExtensionEventBus {
	readonly #handlers = new Map<string, { readonly extension: string; readonly handler: Handler }[]>();
	readonly #chain: { promise: Promise<void> } = { promise: Promise.resolve() };
	readonly #context: EventContext;
	readonly #onIgnored: (result: IgnoredResult) => void;
	readonly #refresh: (() => Promise<void>) | undefined;

	constructor(
		extensions: readonly PiExtension[],
		context: EventContext,
		onIgnored: (result: IgnoredResult) => void,
		refresh?: () => Promise<void>,
	) {
		this.#context = context;
		this.#onIgnored = onIgnored;
		this.#refresh = refresh;
		for (const extension of extensions) {
			for (const [event, handlers] of extension.handlers) {
				const list = this.#handlers.get(event) ?? [];
				for (const handler of handlers) list.push({ extension: extension.path, handler: handler as Handler });
				this.#handlers.set(event, list);
			}
		}
	}

	/** Whether any extension subscribed to `event`. */
	has(event: string): boolean {
		return (this.#handlers.get(event)?.length ?? 0) > 0;
	}

	/** The subscribed event names, for classification. */
	names(): readonly string[] {
		return [...this.#handlers.keys()];
	}

	/**
	 * Dispatch `event` to every handler, in order, serialized with all other
	 * dispatches. A throwing handler is reported and never stops the run.
	 */
	dispatch(event: string, payload: unknown): void {
		if (!this.has(event)) return;
		this.#chain.promise = this.#chain.promise.then(() => this.#run(event, payload)).catch(() => {});
	}

	/**
	 * Dispatch `event` and resolve with the handler results, for events whose
	 * result the harness applies (`input`, `before_agent_start`).
	 */
	async dispatchCollect(event: string, payload: unknown): Promise<readonly unknown[]> {
		if (!this.has(event)) return [];
		const results: unknown[] = [];
		const run = this.#chain.promise.then(() => this.#run(event, payload, results)).catch(() => {});
		this.#chain.promise = run;
		await run;
		return results;
	}

	/** Resolve once every queued dispatch has run, so shutdown work completes. */
	async idle(): Promise<void> {
		await this.#chain.promise;
	}

	async #run(event: string, payload: unknown, collected?: unknown[]): Promise<void> {
		// pi's `ctx.sessionManager` is synchronous, so the snapshot is refreshed
		// once per dispatch and handlers read it without awaiting.
		await this.#refresh?.();
		for (const { extension, handler } of this.#handlers.get(event) ?? []) {
			try {
				const result = await handler(payload, this.#context);
				if (collected !== undefined) collected.push(result);
				this.#checkResult(extension, event, result);
			} catch (error) {
				process.stderr.write(
					`durable-rpc: extension ${extension} failed on ${event}: ${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
		}
	}

	/**
	 * A result field the harness cannot apply is reported, never ignored silently.
	 * `before_agent_start` is the one dispatched event whose result carries
	 * injectable fields (`message`, `systemPrompt`) that an RPC host cannot place.
	 */
	#checkResult(extension: string, event: string, result: unknown): void {
		if (event !== "before_agent_start") return;
		if (result === undefined || result === null || typeof result !== "object") return;
		for (const field of Object.keys(result as Record<string, unknown>)) {
			this.#onIgnored({ extension, event, field });
		}
	}
}