/**
 * Cache warming (tasks 3.1-3.6).
 *
 * pi keeps one prompt cache entry alive by re-sending its request with a one-token
 * output cap before the entry expires. The schedule, the economics, the safety
 * windows, and the status the info panel prints all belong to pi's `CacheWarmer`;
 * this module gives that warmer what it needs in a durable session — the runtime
 * the provider call goes through, a branch of projected entries, and the sink that
 * records a refresh.
 *
 * Durable calls the model runtime it is handed for every request, so the harness
 * hands it a proxy whose `streamSimple` starts warming with exactly the request the
 * provider receives and then delegates.
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loadCacheWarmerModule, type PiCacheWarmerLike, type PiCacheWarmerModule } from "./pi-internals.js";

/** A warm request's usage, in pi's shape, as pi's warmer records it. */
export interface WarmUsage {
	readonly provider: string;
	readonly model: string;
	readonly usage: Record<string, unknown>;
	readonly note?: string;
}

export interface CacheWarmingOptions {
	/** The session's runtime: warm requests go through it, and it decides the TTL. */
	readonly models: ModelRuntime;
	/** pi's warming mode, read at every use so a setting change applies without a restart. */
	readonly mode: () => string;
	/** The branch's projected entries, for the prompt size the economics read. */
	readonly branch: () => readonly unknown[];
	/** Record a completed refresh and answer pi's usage entry for it. */
	readonly appendUsage: (usage: WarmUsage) => void;
}

/** What the engine holds: the warmer, the proxy durable calls, and the lifecycle. */
export interface CacheWarming {
	/** The runtime to hand durable; `streamSimple` arms warming before delegating. */
	readonly models: ModelRuntime;
	get status(): unknown;
	onSettled(): void;
	onModeChanged(): void;
	cancel(): void;
	/** Give the warmer the extension hand-off; without one, pi's own decision stands. */
	setDecider(decide: ((event: { readonly action: string }) => Promise<string>) | undefined): void;
}

/** One request in the prefix, compared structurally because durable rebuilds messages. */
function prefixOf(messages: readonly unknown[]): string {
	return JSON.stringify(messages);
}

/**
 * Build the warmer for one session. The module load is awaited here so the warmer
 * itself is synchronous from the moment durable makes its first request.
 */
export async function createCacheWarming(
	options: CacheWarmingOptions,
	/** How the module is reached; a test supplies its own to watch the wiring. */
	load: () => Promise<unknown> = loadCacheWarmerModule,
): Promise<CacheWarming> {
	const mod = (await load()) as unknown as PiCacheWarmerModule;
	let decide: ((event: { readonly action: string }) => Promise<string>) | undefined;
	const warmer: PiCacheWarmerLike = new mod.CacheWarmer(
		// The warmer's own warm request must not re-arm warming, so it gets the real one.
		options.models as never,
		{
			appendUsage: (kind: string, provider: string, model: string, usage: Record<string, unknown>, note?: string) => {
				options.appendUsage({ provider, model, usage, ...(note === undefined ? {} : { note }) });
				// The projection announces the entry, so nothing consumes this value.
				return { kind, provider, model, usage, ...(note === undefined ? {} : { note }) };
			},
			getBranch: () => options.branch(),
		},
		options.mode,
		async (event) => {
			if (decide === undefined) return event.action;
			try {
				return await decide(event);
			} catch {
				// A failing handler leaves pi's decision in place, as pi does.
				return event.action;
			}
		},
	);

	// The first request of a turn adopts the conversation's provider session id; later
	// requests in the same turn carry compaction's own id and must not replace the entry.
	let adopted: string | undefined;

	const models = new Proxy(options.models as unknown as Record<string | symbol, unknown>, {
		get(target, property, receiver) {
			if (property !== "streamSimple") return Reflect.get(target, property, receiver);
			return (model: unknown, context: { readonly messages: readonly unknown[] }, requestOptions: { readonly sessionId?: string }) => {
				const sessionId = requestOptions?.sessionId;
				if (adopted === undefined || sessionId === undefined || sessionId === adopted) {
					if (adopted === undefined) adopted = sessionId;
					// pi's currency rule: the entry stays warm while the branch still extends
					// the request's prefix. Durable rebuilds messages, so the prefix is compared
					// structurally rather than by object identity.
					const prefix = prefixOf(context.messages);
					const wanted = context.messages;
					// The branch is a projection that can lag the request. Until it has caught up
					// with this request, nothing disproves the entry; once it has, a branch that
					// got shorter is a rewind and the entry is gone.
					let caughtUp = false;
					warmer.start({ model, context, options: requestOptions }, () => {
						// The branch holds pi session entries; a warm entry is written from the
						// messages themselves, so the comparison is between messages.
						const current = options
							.branch()
							.filter((entry) => (entry as { type?: string }).type === "message")
							.map((entry) => (entry as { readonly message?: unknown }).message);
						if (current.length >= wanted.length) {
							caughtUp = true;
							return prefixOf(current.slice(0, wanted.length)) === prefix;
						}
						return !caughtUp;
					});
				}
				return (target.streamSimple as (...args: unknown[]) => unknown).call(target, model, context, requestOptions);
			};
		},
	}) as unknown as ModelRuntime;

	return {
		models,
		get status() {
			return warmer.status;
		},
		onSettled() {
			adopted = undefined;
			warmer.onAgentSettled();
		},
		onModeChanged() {
			warmer.onModeChanged();
		},
		cancel() {
			adopted = undefined;
			warmer.cancel();
		},
		setDecider(next) {
			decide = next;
		},
	};
}
