/**
 * The durable engine: one Harness over one session, wired from pi's loaded
 * resources (tasks 3.4, 8.1, 8.2).
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	Harness,
	InboxDoc,
	LiveDoc,
	MemoryStorage,
	type AgentChange,
	type Conversation,
	type ConversationId,
	type ConversationView,
	type EntryRecord,
	type HarnessSettings,
	type ModelRef,
	type Storage,
	type Submission,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
	DefaultResourceLoader,
	ModelRuntime,
	SettingsManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ScopedModel } from "@earendil-works/pi-coding-agent";
import type { Pool } from "pg";
import { currentConversation, sessionFile, sessionLocation, sessionPrefix, setCurrentConversation, stampSession } from "./session.js";
import type { HarnessConfig } from "./config.js";
import { createHarnessSettings } from "./settings.js";
import { createCacheWarming, type CacheWarming } from "./warming.js";
import { projectEntries } from "./projection.js";
import { classifyReport, outcomeLine, reopenDelayMs, shouldStamp, unansweredReason } from "./reports.js";
import { withTimeout } from "./shutdown.js";
import { advanceCursor, appendedMessages, lastAnswerOf, planRead, rewritesContext, type SnapshotCursor } from "./read-plan.js";
import { createPromptExtension, type PromptResources } from "./prompt.js";
import { skillCommands, type RpcCommandInfo } from "./skills.js";

/** A session-lifecycle event, as pi shapes it (task 3.11). */
export type PiSessionEvent =
	| { readonly type: "session_before_switch"; readonly reason: "new" | "resume"; readonly targetSessionFile?: string }
	| { readonly type: "session_before_fork"; readonly entryId: string; readonly position: "before" | "at" }
	| { readonly type: "session_before_tree"; readonly [key: string]: unknown };

/** One `session_before_*` handler; a `{ cancel: true }` result vetoes the change. */
export type PiSessionHandler = (event: PiSessionEvent) => unknown;
import { FileTools, CodemodeTools, PiCodingTools, platformShellTools } from "../tools/index.js";
import { configureCodemodeDescription } from "../tools/codemode.js";
import { type McpSettings, type ResolvedServer } from "../tools/exposure.js";
import type { McpToolEntry } from "../tools/mcp.js";
import { setDeclaredTools, setMcpEntries, exposureOf, isMcpTool } from "../tools/state.js";
import { isCallable } from "../tools/exposure.js";
import { toCodemodeIdentifier } from "@earendil-works/pi-codemode";
import { CODEMODE_OUTPUT_TYPES } from "../tools/pi-definitions.js";
import { computeActivation, computeDeclaredTools } from "../tools/activate.js";
import { ControlEntry, PolicyEntry, renderTranscriptHtml, type ControlData, type Policy } from "./projection.js";
import type { Revision, RevisionStream } from "./events.js";

const CONTEXT = BACKGROUND_CONTEXT;

/** How long a close may take before a reopen moves on (task 2.5). */
const CLOSE_TIMEOUT_MS = 5_000;

/**
 * A prompt arrived while a failed session was being reopened (task 2.2). The framework's invariant 8
 * means commits reject in that window, so the host refuses the work by name instead of letting each
 * commit surface as a storage error.
 */
export class SessionRecoveringError extends Error {
	constructor() {
		super("the session is recovering from a storage failure; retry when it has reopened");
		this.name = "SessionRecoveringError";
	}
}

/** Append pi's `Codemode:` line to a callable tool's description (task 5.6). */
function appendCodemodeLine(tool: import("@earendil-works/pi-durable").ToolRegistration): void {
	if (tool.name === "codemode" || tool.name === "tool_search") return;
	if (!isCallable(exposureOf(tool.name))) return;
	const resolves = isMcpTool(tool.name) ? "`{ content, structuredContent?, isError? }`" : (CODEMODE_OUTPUT_TYPES[tool.name] ?? "a string");
	const line = `\n\nCodemode: \`tools.${toCodemodeIdentifier(tool.name)}(args)\` resolves to ${resolves}.`;
	const description = tool.description ?? "";
	if (!description.endsWith(line)) tool.description = `${description}${line}`;
}

/** One execution environment per directory, shared by every conversation in it. */
class ExecutionEnvs {
	readonly #defaultCwd: string;
	readonly #envs = new Map<string, NodeExecutionEnv>();

	constructor(defaultCwd: string) {
		this.#defaultCwd = defaultCwd;
	}

	readonly env = ({ cwd = this.#defaultCwd }: { readonly cwd?: string }): NodeExecutionEnv => {
		let env = this.#envs.get(cwd);
		if (env === undefined) {
			env = new NodeExecutionEnv({ cwd });
			this.#envs.set(cwd, env);
		}
		return env;
	};
}

export interface OpenedStorage {
	readonly storage: Storage;
	/** Record that the session was used now; PostgreSQL only, since SQLite has its mtime. */
	readonly stamp?: () => Promise<void>;
	close(): Promise<void>;
}

/**
 * Open one session's storage (tasks 2.1-2.3). The container is the session; the
 * working directory and tenant only name it.
 */
export async function openSessionStorage(
	config: HarnessConfig,
	key: string,
	/** Called when an idle pooled client fails: without an `error` listener, `pg` throws and the
	 *  process exits before the session can report the failure (task 3.3). */
	onPoolError?: (error: unknown) => void,
): Promise<OpenedStorage> {
	if (config.ephemeral) {
		return { storage: new MemoryStorage(), close: async () => {} };
	}
	if (config.pg !== undefined) {
		// Loaded on demand: the backends pull large libraries, and Node 22 warns
		// about `node:sqlite` the moment it is required — even for `--help`.
		const [{ default: pg }, { openPostgresStorage }] = await Promise.all([
			import("pg"),
			import("../storage/postgres/storage.js"),
		]);
		const { connectionOptions, describeConnection } = await import("../storage/postgres/connection.js");
		const { assertEncrypted, connectionHint } = await import("../storage/postgres/ssl.js");
		const connectionString = describeConnection(config.pg);
		// The policy reads app.session, so every connection the pool opens is scoped. The
		// session option goes last, after any inherited options.
		const pool: Pool = new pg.Pool(
			connectionOptions(config.pg, `-c app.session=${sessionPrefix(config.tenant, key)}`) as never,
		);
		// An idle client whose server vanished emits `error` on the pool; unhandled, that is fatal to
		// the process. Reporting it lets the session fail the way the framework expects, and reopen.
		pool.on("error", (error: unknown) => onPoolError?.(error));
		if (config.pg.ssl.enforce) {
			const probe = await pool.connect().catch(async (error: unknown) => {
				const hint = connectionHint(connectionString, error);
				await pool.end().catch(() => {});
				throw new Error(
					`PostgreSQL connection failed: ${error instanceof Error ? error.message : String(error)}${hint === undefined ? "" : `\n${hint}`}`,
				);
			});
			try {
				await assertEncrypted(probe);
			} finally {
				probe.release();
			}
		}
		const storage = await openPostgresStorage({
			pool,
			schema: config.schema,
			prefix: sessionPrefix(config.tenant, key),
			session: key,
			...(onPoolError === undefined ? {} : { onError: onPoolError }),
		}).catch(async (error: unknown) => {
			// The pool would keep the process alive after the failure is reported.
			await pool.end().catch(() => {});
			throw error;
		});
		const stamp = () => stampSession(config, key);
		await stamp().catch(() => {});
		return {
			storage,
			stamp,
			close: async () => {
				// A dead server can leave `pool.end()` waiting on clients that will never answer, so
				// the close is bounded: recovery must be able to move on (task 2.5).
				await withTimeout(storage.close(CONTEXT), CLOSE_TIMEOUT_MS);
				await withTimeout(pool.end(), CLOSE_TIMEOUT_MS);
			},
		};
	}
	const path = sessionFile(config, key);
	await mkdir(dirname(path), { recursive: true });
	const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
	const storage = await openNodeSqliteStorage(path);
	return { storage, close: () => storage.close(CONTEXT) };
}

export interface HarnessEngineOptions {
	readonly config: HarnessConfig;
	readonly key: string;
	readonly modelRuntime: ModelRuntime;
	readonly settingsManager: SettingsManager;
	readonly resources: PromptResources;
	/** Extra extensions installed before the Harness opens, such as MCP tools. */
	readonly extraExtensions?: readonly import("@earendil-works/pi-durable").Extension[];
	/** The MCP exposure table and settings that decide activation (tasks 1.3, 2.2). */
	readonly mcp?: { readonly entries: readonly McpToolEntry[]; readonly settings: McpSettings };
	/** The model `--model`/`--models`/`--api-key` resolved, when one was named. */
	readonly resolvedModel?: Model<string>;
	/** The thinking level the resolution carried, so a `:high` suffix applies. */
	readonly resolvedThinking?: ModelThinkingLevel;
	/** `--models`: the scope startup and cycling use; absent means every available model. */
	readonly modelScope?: readonly ScopedModel[];
}

export class HarnessEngine {
	/** Replaced by a reopen after a storage failure (task 2.1). */
	#harness: Harness;
	readonly #settingsManager: SettingsManager;
	readonly #modelRuntime: ModelRuntime;
	#closeStorage: () => Promise<void>;
	/** Records that the session was used; PostgreSQL keeps a catalog, SQLite has mtime. */
	#stamp: (() => Promise<void>) | undefined;
	/** `--models`: the models startup and cycling may use, in pattern order. */
	readonly #modelScope: readonly ScopedModel[];
	readonly #resources: PromptResources;
	readonly #registry: import("@earendil-works/pi-durable").Registry;
	/** Holder of the MCP servers the prompt's `mcp_servers` section describes. */
	readonly #mcpServers: { servers: readonly ResolvedServer[] };
	/** The conversation the session first created; a rewind forks it. */
	readonly #rootId: string | undefined;
	/** Where the session lives and what it is called, for the pointer beside it. */
	readonly #identity: { readonly config: HarnessConfig; readonly key: string };
	/** The thinking level last configured, so the synchronous getter can answer. */
	#thinkingLevel: string | undefined;
	/** The tools the conversation declares, captured at open (extension action reads). */
	#declaredTools: readonly { readonly name: string; readonly description?: string; readonly parameters?: unknown }[] = [];
	/** Extension commands, registered by the extension host (task 3.9). */
	readonly #extensionCommands: RpcCommandInfo[] = [];
	/** Extension command handlers, keyed by command name (task 3.10). */
	readonly #commandHandlers = new Map<string, (args: string) => unknown>();
	/** Session-lifecycle handlers consulted before a session change (task 3.11). */
	readonly #sessionHandlers: PiSessionHandler[] = [];
	#conversation: Conversation;
	/** pi's cache warmer, or undefined when the session cannot warm (task 3.1). */
	#warming: CacheWarming | undefined;
	/** The branch pi's economics read, kept current by every read of the entries (task 3.1). */
	#branch: unknown[];
	/** What the last read held, so the next read asks only for the delta (tasks 1.1, 2.1). */
	#cursor: SnapshotCursor = { entryCount: 0, messageCount: 0 };
	/** The context messages the last read accounts for (task 2.2). */
	#messages: unknown[] = [];
	/** The raw entries the snapshot holds, which is what a surface renders (task 2.2). */
	#records: EntryRecord[] = [];
	/** The run policy the last read saw, so a status answer reads no entry (task 3.2). */
	#policy: Policy = {};
	/** The agent the last read saw, so a status answer reads no entry (task 3.2). */
	#agent: Awaited<ReturnType<Conversation["agent"]>> | undefined;
	/** True while a failed session is being reopened; prompts are refused meantime (task 2.2). */
	#recovering = false;
	/** Reopen attempts that failed, for the backoff (task 2.4). */
	#reopenAttempts = 0;
	/** Where a framework failure is shown: the interface's error line, or stderr (task 1.2). */
	#onFailure: (line: string) => void = (line) => process.stderr.write(`pi-durable: ${line}\n`);
	/** How the session is opened again after a storage failure (task 2.1). */
	#reopen: (() => Promise<{ harness: Harness; conversation: Conversation; closeStorage: () => Promise<void>; stamp?: () => Promise<void> }>) | undefined;
	/** When the catalog stamp last ran, so a turn does not spend a round trip on it (task 5.1). */
	#stampedAt = 0;
	/** The last run's answer or the reason it had none (task 4.1). */
	#lastOutcome: { readonly answered: boolean; readonly reason?: string } = { answered: false };

	private constructor(options: {
		harness: Harness;
		conversation: Conversation;
		settingsManager: SettingsManager;
		modelRuntime: ModelRuntime;
		resources: PromptResources;
		registry: import("@earendil-works/pi-durable").Registry;
		mcpServers?: { servers: readonly ResolvedServer[] };
		rootId?: string;
		identity: { readonly config: HarnessConfig; readonly key: string };
		closeStorage: () => Promise<void>;
		stamp?: () => Promise<void>;
		modelScope?: readonly ScopedModel[];
		warming?: CacheWarming;
		branch?: unknown[];
		reopen?: () => Promise<{ harness: Harness; conversation: Conversation; closeStorage: () => Promise<void>; stamp?: () => Promise<void> }>;
	}) {
		this.#harness = options.harness;
		this.#conversation = options.conversation;
		this.#settingsManager = options.settingsManager;
		this.#modelRuntime = options.modelRuntime;
		this.#resources = options.resources;
		this.#mcpServers = options.mcpServers ?? { servers: [] };
		this.#rootId = options.rootId;
		this.#identity = options.identity;
		this.#registry = options.registry;
		this.#closeStorage = options.closeStorage;
		this.#stamp = options.stamp;
		this.#modelScope = options.modelScope ?? [];
		this.#warming = options.warming;
		this.#branch = options.branch ?? [];
		this.#reopen = options.reopen;
	}

	static async open(options: HarnessEngineOptions): Promise<HarnessEngine> {
		const { config, key, modelRuntime, settingsManager, resources } = options;
		// The engine is built after the storage, so a pool error reaches it through this handle.
		let engineRef: HarnessEngine | undefined;
		const poolError = (error: unknown): void => engineRef?.handlePoolError(error);
		const opened = await openSessionStorage(config, key, poolError);
		try {
			const settings: HarnessSettings = createHarnessSettings(settingsManager, { persistWithinMs: config.persistWithinMs });
			const registry = (await import("@earendil-works/pi-durable")).createRegistry();
			registry.install(PiCodingTools);
			registry.install(FileTools);
			registry.install(platformShellTools());
			registry.install(CodemodeTools);
			// The prompt extension is built before the engine exists, so it reads the
			// servers through this holder, which a reload can replace.
			const servers: { servers: readonly ResolvedServer[] } = { servers: options.mcp?.settings.servers ?? [] };
			registry.install(createPromptExtension(resources, () => servers.servers));
			for (const extension of options.extraExtensions ?? []) registry.install(extension);

			// Exposure table (task 1.3); the composed codemode description needs the callable set, applied below.
			setMcpEntries(options.mcp?.entries ?? []);

			// Activation (task 2.2) and the explicit declared set (task 2.1).
			const defaultTools = (settingsManager.getSettings().defaultTools ?? []) as readonly string[];
			// pi's codemode setting decides what is declared: "only" exposes no direct tool.
			const codemodeMode = ((settingsManager.getSettings() as { codemode?: { mode?: string } }).codemode?.mode ?? "on") as "on" | "only";
			const activation = computeActivation(
				options.mcp?.settings.servers ?? [],
				options.mcp?.settings.autoEnableCodemode ?? true,
				defaultTools,
				codemodeMode,
			);
			for (const warning of activation.warnings) process.stderr.write(`pi-durable: ${warning}\n`);
			const declared = computeDeclaredTools(
				(
					registry.snapshot().tools() as readonly { readonly tool: import("@earendil-works/pi-durable").ToolRegistration }[]
				).map((entry) => entry.tool),
				activation,
				defaultTools,
				codemodeMode,
			);
			// A script may call what the model may call; the codemode tool reads this set.
			setDeclaredTools(declared.map((tool) => tool.name));
			if (activation.codemode) for (const tool of declared) appendCodemodeLine(tool);
			if (activation.codemode) {
				const entryTools = registry
					.snapshot()
					.tools() as readonly { readonly tool: import("@earendil-works/pi-durable").ToolRegistration }[];
				const indirect = new Set(
					(options.mcp?.entries ?? [])
						.filter((entry) => entry.exposure === "codemode" || entry.exposure === "codemode-deferred" || entry.exposure === "deferred")
						.map((entry) => entry.name),
				);
				// "only" lists every tool codemode can reach; otherwise only the indirect ones.
				const callable = codemodeMode === "only"
					? entryTools.filter((entry) => entry.tool.name !== "codemode" && entry.tool.name !== "tool_search").map((entry) => entry.tool)
					: entryTools.filter((entry) => indirect.has(entry.tool.name)).map((entry) => entry.tool);
				await configureCodemodeDescription(callable);
			}
			const envs = new ExecutionEnvs(config.cwd);
			// The warmer needs the runtime durable calls, so it is built first and its proxy
			// is what durable receives; the branch and the usage sink reach the conversation
			// through holders that are filled in below (tasks 3.1, 3.5).
			const holder: { conversation?: Conversation; branch: unknown[] } = { branch: [] };
			const branch = (): unknown[] => holder.branch;
			const warming = await createCacheWarming({
				models: modelRuntime,
				mode: () => settingsManager.getCacheWarmingMode(),
				branch,
				appendUsage: (usage) => {
					const conversation = holder.conversation;
					if (conversation === undefined) return;
					void conversation
						.commit(
							(tx) =>
								tx.appendEntry(ControlEntry, conversation.id, {
									data: { type: "cache_warm", ...usage } as never,
								}),
							CONTEXT,
						)
						.catch(() => {});
				},
			});
			// A report is how the framework says a session failed or a task faulted (tasks 1.1, 1.2).
			const onReport = (report: { readonly kind?: string; readonly error?: unknown; readonly reason?: string }): void => {
				engineRef?.handleReport(report);
			};
			const harness = await Harness.open(
				opened.storage,
				{
					models: warming.models,
					registry,
					settings,
					env: envs.env,
					onReport,
				},
				CONTEXT,
			);
			const agent = initialAgent(config, settingsManager, modelRuntime, options.resolvedModel, options.resolvedThinking);
			const root = await harness.root(CONTEXT, { agent: { ...agent, tools: declared } });
			harness.resume();
			// A rewind leaves the session continuing in a fork; the pointer says which.
			const recorded = await currentConversation(config, key).catch(() => undefined);
			const resumed = recorded === undefined ? undefined : await harness.conversation(recorded as never, CONTEXT);
			const conversation = resumed ?? root;
			holder.conversation = conversation;
			const opened2 = new HarnessEngine({
				harness,
				conversation,
				settingsManager,
				modelRuntime,
				resources,
				registry,
				closeStorage: opened.close,
				...(opened.stamp === undefined ? {} : { stamp: opened.stamp }),
				...(options.modelScope === undefined ? {} : { modelScope: options.modelScope }),
				mcpServers: servers,
				rootId: String(root.id),
				identity: { config, key },
				warming,
				branch: holder.branch,
				// A storage failure reopens the same session storage (task 2.1): the reopen decides
				// the committed prefix, so nothing is reconstructed from memory.
				...(config.ephemeral ? {} : { reopen: async () => {
					const again = await openSessionStorage(config, key, poolError);
					const next = await Harness.open(
						again.storage,
						{ models: warming.models, registry, settings, env: envs.env, onReport },
						CONTEXT,
					);
					const recorded = await currentConversation(config, key).catch(() => undefined);
					const resumed = recorded === undefined ? undefined : await next.conversation(recorded as never, CONTEXT);
					const conversation = resumed ?? (await next.root(CONTEXT, { agent: { ...agent, tools: declared } }));
					next.resume();
					holder.conversation = conversation;
					return { harness: next, conversation, closeStorage: again.close, ...(again.stamp === undefined ? {} : { stamp: again.stamp }) };
				} }),
			});
			engineRef = opened2;
			opened2.#thinkingLevel = agent.thinkingLevel ?? undefined;
			opened2.#declaredTools = declared.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			}));
			// One read seeds the snapshot, so a status answer and the interface never make the
			// first read themselves (tasks 2.3, 3.2).
			await opened2.prime().catch(() => {});
			return opened2;
		} catch (error) {
			await opened.close().catch(() => {});
			throw error;
		}
	}

	get conversationId(): ConversationId {
		return this.#conversation.id;
	}

	get conversation(): Conversation {
		return this.#conversation;
	}

	get modelRuntime(): ModelRuntime {
		return this.#modelRuntime;
	}

	get settingsManager(): SettingsManager {
		return this.#settingsManager;
	}

	/**
	 * Replace the prompt resources after a `/reload`. The prompt extension closes over
	 * the object it was built with and reads it when a request is prepared, so updating
	 * its fields is what makes a new skill, prompt, or AGENTS.md reach the next request
	 * without reopening the session.
	 */
	applyResources(next: Partial<PromptResources>): void {
		for (const [key, value] of Object.entries(next)) {
			if (value === undefined) continue;
			(this.#resources as unknown as Record<string, unknown>)[key] = value;
		}
	}

	/** Every installed tool, for a reload that has to recompute what to declare. */
	toolRegistrations(): readonly import("@earendil-works/pi-durable").ToolRegistration[] {
		return (this.#registry.snapshot().tools() as readonly { readonly tool: import("@earendil-works/pi-durable").ToolRegistration }[]).map(
			(entry) => entry.tool,
		);
	}

	/**
	 * Replace the MCP servers and the tools after a `/reload`: the prompt's
	 * `mcp_servers` section reads the holder, and the conversation takes the new tool
	 * set, so a server added or removed is visible to the next request.
	 */
	async applyMcp(
		servers: readonly ResolvedServer[],
		mcpTools: readonly import("@earendil-works/pi-durable").ToolRegistration[],
		tools: readonly import("@earendil-works/pi-durable").ToolRegistration[],
	): Promise<void> {
		this.#mcpServers.servers = servers;
		// `install` replaces an installed extension of the same name in place, so the
		// registry — which the codemode sandbox and the declared set both read — learns
		// about a server added or removed since startup.
		this.#registry.install({ name: "harness.mcp", tools: [...mcpTools] } as never);
		this.#declaredTools = tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
		await this.configure({ tools } as never);
	}

	/** The skills loaded once at startup, for command listing and expansion (tasks 2.1-2.4). */
	get skills(): readonly Skill[] {
		return this.#resources.skills;
	}

	/** The tool names the conversation declares, for `pi.getActiveTools()`. */
	declaredToolNames(): string[] {
		return this.#declaredTools.map((tool) => tool.name);
	}

	/** Every installed tool, for `pi.getAllTools()`. */
	allTools(): readonly { readonly name: string; readonly description?: string; readonly parameters?: unknown }[] {
		return this.#declaredTools;
	}

	/** The registrations naming `names`, for `pi.setActiveTools()`. */
	activeTools(names: readonly string[]): import("@earendil-works/pi-durable").ToolRegistration[] {
		const wanted = new Set(names);
		return (this.#registry.snapshot().tools() as readonly { readonly tool: import("@earendil-works/pi-durable").ToolRegistration }[])
			.map((entry) => entry.tool)
			.filter((tool) => wanted.has(tool.name));
	}

	/** The current thinking level, for `pi.getThinkingLevel()` and pi's footer. */
	currentThinkingLevel(): string | undefined {
		return this.#thinkingLevel;
	}

	/**
	 * Remember a thinking level now and persist it in the background. pi's interface is a
	 * synchronous client: it renders the level before any write completes, so the level the
	 * interface sees must not be a promise.
	 */
	rememberThinkingLevel(level: string): void {
		this.#thinkingLevel = level;
	}

	/** Register an extension command so `get_commands` and prompt resolution see it (task 3.9). */
	registerCommand(command: RpcCommandInfo, handler: (args: string) => unknown): void {
		this.#extensionCommands.push(command);
		this.#commandHandlers.set(command.name, handler);
	}

	/**
	 * Resolve a `/name args` message against the extension commands and run its
	 * handler (task 3.10). Returns `true` when a command handled the message, so
	 * the caller reports `handled` and starts no model run.
	 */
	async runCommand(message: string): Promise<boolean> {
		if (!message.startsWith("/")) return false;
		const space = message.indexOf(" ");
		const name = space === -1 ? message.slice(1) : message.slice(1, space);
		const handler = this.#commandHandlers.get(name);
		if (handler === undefined) return false;
		await handler(space === -1 ? "" : message.slice(space + 1).trim());
		return true;
	}

	/**
	 * The `get_commands` payload in pi's order: extension commands, prompt
	 * templates, then skills (tasks 2.1, 2.2, 3.9).
	 */
	commands(): readonly RpcCommandInfo[] {
		return [
			...this.#extensionCommands,
			...this.#resources.prompts.map((prompt) => ({
				name: prompt.name,
				description: prompt.description,
				source: "prompt" as const,
				sourceInfo: prompt.sourceInfo,
			})),
			...skillCommands(this.#resources.skills),
		];
	}

	messages(): Promise<readonly unknown[]> {
		return this.#conversation.context(CONTEXT).then((view) => view.messages);
	}

	/**
	 * Seed the snapshot once, at open (task 2.3): the agent, the policy, the cursor, and the
	 * context messages. Every later read is a probe unless something changed.
	 */
	async prime(): Promise<void> {
		this.#agent = await this.resolvedAgent().catch(() => undefined);
		const records = await this.entries(Number.MAX_SAFE_INTEGER);
		this.#records = [...records];
		this.#cursor = advanceCursor(records, { entryCount: 0, messageCount: 0 });
		this.#messages = [...(await this.messages().catch(() => []))];
		this.#policy = await this.storedPolicy().catch(() => this.#policy);
	}

	/** The newest entry id: the one statement an idle poll issues (task 1.1). */
	async probeEntryId(): Promise<number | string | undefined> {
		const page = await this.#conversation.entries({ order: "descending" }, 1, undefined, CONTEXT);
		return page.items[0]?.id;
	}

	/**
	 * Read what changed since the last read (tasks 1.2, 2.1, 2.2). An idle session reads no
	 * entry record, an append reads the entries after the held id, and a branch that moved
	 * backwards is read whole.
	 */
	async readChanges(): Promise<{ readonly entries: readonly EntryRecord[]; readonly full: boolean }> {
		const plan = planRead(await this.probeEntryId(), this.#cursor);
		if (plan.kind === "none") return { entries: [], full: false };
		const entries =
			plan.kind === "delta"
				? await this.#conversation
						.entries({ order: "ascending" }, Number.MAX_SAFE_INTEGER, plan.after as never, CONTEXT)
						.then((page) => page.items)
				// A full read refreshes the branch the warmer evaluates as well.
				: await this.entries(Number.MAX_SAFE_INTEGER);
		this.#cursor = advanceCursor(entries, this.#cursor);
		// The snapshot holds the whole branch: a delta appends, a full read replaces.
		this.#records = plan.kind === "full" ? [...entries] : [...this.#records, ...entries];
		// The warmer and the extension snapshot read the projected branch, so it follows too.
		const projected = projectEntries(this.#records).entries;
		this.#branch.length = 0;
		this.#branch.push(...projected);
		// A compaction rewrites what the context holds, so the messages are asked for rather
		// than appended; otherwise the delta is appended and no further record is read.
		if (plan.kind === "full" || rewritesContext(entries)) {
			// Compaction, fork and summary rules decide what the context holds, so this one
			// case asks the storage instead of deriving. It is the rare case: a first
			// snapshot, a rewind, or a compaction entry in the delta.
			this.#messages = [...(await this.messages())];
		} else {
			this.#messages = [...this.#messages, ...appendedMessages(entries)];
		}
		const policyEntry = [...entries].reverse().find((entry) => entry.kind === "harness.policy");
		if (policyEntry !== undefined) this.#policy = { ...this.#policy, ...((policyEntry.data ?? {}) as Policy) };
		this.#agent = await this.resolvedAgent().catch(() => this.#agent);
		return { entries, full: plan.kind === "full" };
	}

	/** The context messages the last read accounts for (task 2.2). */
	get messagesKnown(): readonly unknown[] {
		return this.#messages;
	}

	/** The entries the snapshot holds: what a surface renders without reading (task 2.2). */
	get knownEntries(): readonly EntryRecord[] {
		return this.#records;
	}

	/** The last answer, from the messages already read (task 2.2). */
	get lastAnswerKnown(): string | undefined {
		return lastAnswerOf(this.#messages);
	}

	/** The run policy the last read saw (task 3.2). */
	get policyKnown(): Policy {
		return this.#policy;
	}

	/** The agent the last read saw (task 3.2). */
	get agentKnown(): Awaited<ReturnType<Conversation["agent"]>> | undefined {
		return this.#agent;
	}

	/** The built-in documents alone, for a refresh that already read its entries (task 3.1). */
	async documents(): Promise<Readonly<Record<string, unknown>>> {
		const id = this.#conversation.id;
		const [inbox, live] = await Promise.all([this.watchOnce(InboxDoc, id), this.watchOnce(LiveDoc, id)]);
		return {
			...(inbox === undefined ? {} : { "pi.inbox": inbox as never }),
			...(live === undefined ? {} : { "pi.live": live as never }),
		};
	}

	/**
	 * Everything a status answer needs, without reading the transcript (task 3.1): the two
	 * documents, the newest entry id, and what the snapshot already holds.
	 */
	async status(): Promise<{
		readonly live: unknown;
		readonly inbox: unknown;
		readonly newestEntryId: number | string | undefined;
		readonly entryCount: number;
		readonly messageCount: number;
		readonly policy: Policy;
		readonly agent: Awaited<ReturnType<Conversation["agent"]>> | undefined;
	}> {
		const id = this.#conversation.id;
		const [live, inbox, newestEntryId] = await Promise.all([this.watchOnce(LiveDoc, id), this.watchOnce(InboxDoc, id), this.probeEntryId()]);
		// A status answer never reads a record: the count comes from the cursor the last read
		// left, and the policy and the agent from what that read saw.
		const { entryCount, messageCount } = this.#cursor;
		return { live, inbox, newestEntryId, entryCount, messageCount, policy: this.#policy, agent: this.#agent };
	}

	/**
	 * Ask the session-lifecycle handlers whether a session change may proceed
	 * (task 3.11). The consult runs before the change captures state, so a veto
	 * leaves the session unchanged. The first `cancel` wins, as in pi.
	 */
	async sessionVeto(event: PiSessionEvent): Promise<boolean> {
		for (const handler of this.#sessionHandlers) {
			const result = (await handler(event)) as { readonly cancel?: boolean } | undefined;
			if (result?.cancel === true) return true;
		}
		return false;
	}

	/** Install the session-lifecycle handlers found on the loaded extensions (task 3.11). */
	installSessionHandlers(handlers: readonly PiSessionHandler[]): void {
		this.#sessionHandlers.push(...handlers);
	}

	currentModel(): ModelRef | undefined {
		return undefined;
	}

	resolvedAgent(): Promise<Awaited<ReturnType<Conversation["agent"]>>> {
		return this.#conversation.agent(CONTEXT);
	}

	/**
	 * The built-in documents and the full transcript (tasks 5.1, 5.3).
	 * `Conversation.viewState()` is gone in 1.5.2, and a watched view is only a
	 * window, so the state read is assembled from one-shot document reads.
	 */
	async view(): Promise<ConversationView> {
		const id = this.#conversation.id;
		const [inbox, live, entries] = await Promise.all([
			this.watchOnce(InboxDoc, id),
			this.watchOnce(LiveDoc, id),
			this.entries(Number.MAX_SAFE_INTEGER),
		]);
		return {
			conversation: { id } as unknown as ConversationView["conversation"],
			entries,
			docs: {
				...(inbox === undefined ? {} : { "pi.inbox": inbox as never }),
				...(live === undefined ? {} : { "pi.live": live as never }),
			},
		};
	}

	/** One-shot document read: acquire the watch, take its value, stop it. */
	async watchOnce<T extends import("@earendil-works/pi-durable").JsonObject>(
		token: import("@earendil-works/pi-durable").ConversationDocToken<T>,
		id: ConversationId,
	): Promise<T | undefined> {
		try {
			const watch = await this.#harness.watchDoc(token, id, CONTEXT);
			if (watch === undefined) return undefined;
			const value = watch.value;
			await watch.stop();
			return value as T;
		} catch {
			return undefined;
		}
	}

	entries(limit = 512): Promise<readonly EntryRecord[]> {
		return this.#conversation.entries({ order: "ascending" }, limit, undefined, CONTEXT).then((page) => {
			// The warmer reads the branch synchronously, so the projected entries are kept
			// here: every read of the entries is a chance to make that view current.
			const projected = projectEntries(page.items).entries;
			this.#branch.length = 0;
			this.#branch.push(...projected);
			return page.items;
		});
	}

	submit(content: string | readonly unknown[], whenBusy?: "steer" | "followUp" | "reject"): Promise<Submission> {
		if (this.#recovering) return Promise.reject(new SessionRecoveringError());
		return this.#conversation.submit(
			whenBusy === undefined
				? { type: "input", content: content as never }
				: { type: "input", content: content as never, whenBusy },
			CONTEXT,
		);
	}

	/** Where this session's entries live, as pi's panel and the RPC status report it (task 4.1). */
	get sessionLocation(): string | undefined {
		return sessionLocation(this.#identity.config, this.#identity.key);
	}

	/** Where a framework failure is shown; the interface installs its error line (task 1.2). */
	setFailureReporter(report: (line: string) => void): void {
		this.#onFailure = report;
	}

	/** Whether a failed session is being reopened (task 2.2). */
	get recovering(): boolean {
		return this.#recovering;
	}

	/** The last run: answered, or the reason it had none (task 4.1). */
	get lastOutcome(): { readonly answered: boolean; readonly reason?: string } {
		return this.#lastOutcome;
	}

	/**
	 * One report from the framework (tasks 1.1, 1.2, 2.1). A failed session is reopened; a faulted
	 * task is shown; anything else is a diagnostic. The framework calls this once per problem.
	 */
	/**
	 * A pooled connection failed while idle (task 3.3). Without this, `pg` throws out of the process
	 * on an idle client's error before the session can report a failure. The reopen is idempotent, so
	 * reporting the loss and handing the session to it is safe even if no commit follows.
	 */
	handlePoolError(error: unknown): void {
		this.#onFailure(`connection lost: ${error instanceof Error ? error.message : String(error)}`);
		void this.#recover();
	}

	handleReport(report: { readonly kind?: string; readonly error?: unknown; readonly reason?: string }): void {
		const classified = classifyReport(report);
		this.#onFailure(classified.line);
		if (classified.class === "session") void this.#recover();
	}

	/**
	 * Reopen a session whose storage failed (tasks 2.1, 2.3, 2.4, 2.6, 2.7). Invariant 8 of the framework:
	 * a storage error is fatal to the open session, which must be reopened — the reopen decides the
	 * committed prefix, so the transcript is read again rather than rebuilt from memory.
	 */
	async #recover(): Promise<void> {
		// An in-memory session cannot be reopened: a second open would start empty and present a
		// different session as if it were this one (task 2.6).
		if (this.#reopen === undefined) {
			this.#onFailure("the session cannot be reopened: an in-memory session keeps nothing to reopen");
			return;
		}
		if (this.#recovering) return;
		this.#recovering = true;
		const conversationId = this.#conversation.id;
		try {
			while (true) {
				this.#reopenAttempts += 1;
				try {
					// A dead server can hang either close instead of failing it, so both are bounded
					// by the same wait the signal handler uses (task 2.5).
					await withTimeout(this.#harness.close(CONTEXT), CLOSE_TIMEOUT_MS);
					await withTimeout(this.#closeStorage(), CLOSE_TIMEOUT_MS);
					const reopened = await this.#reopen();
					this.#harness = reopened.harness;
					this.#closeStorage = reopened.closeStorage;
					if (reopened.stamp !== undefined) this.#stamp = reopened.stamp;
					this.#conversation = reopened.conversation;
					// The snapshot is read again: what storage holds is the truth after a reopen.
					this.#cursor = { entryCount: 0, messageCount: 0 };
					this.#records = [];
					this.#messages = [];
					this.#recovering = false;
					this.#reopenAttempts = 0;
					await this.prime().catch(() => {});
					this.#onFailure(`session reopened at conversation ${String(conversationId)}`);
					return;
				} catch (error) {
					// The server may still be down: report, wait, try again (task 2.4). A lock refusal
					// here is our own previous connection, not another process (task 2.7).
					const name = error instanceof Error ? error.name : "";
					const detail = error instanceof Error ? error.message : String(error);
					this.#onFailure(
						name === "SessionLockedError"
							? `reopen attempt ${this.#reopenAttempts}: waiting for the previous connection to be released (${detail})`
							: `reopen attempt ${this.#reopenAttempts} failed: ${detail}`,
					);
					await new Promise((resolve) => setTimeout(resolve, reopenDelayMs(this.#reopenAttempts)));
				}
			}
		} finally {
			this.#recovering = false;
		}
	}

	/** What the info panel prints for cache warming (task 3.4). */
	get cacheWarmingStatus(): unknown {
		return this.#warming?.status;
	}

	/** The extension hand-off for a warming decision (task 3.6). */
	setCacheWarmingDecider(decide: ((event: { readonly action: string }) => Promise<string>) | undefined): void {
		this.#warming?.setDecider(decide);
	}

	/** The warming mode changed, so an active run is reconciled (task 3.3). */
	cacheWarmingModeChanged(): void {
		this.#warming?.onModeChanged();
	}

	/** Submit one prompt and resolve to whether it was answered (task 2.2). */
	async submitAndWait(content: string | readonly unknown[], whenBusy?: "steer" | "followUp"): Promise<boolean> {
		// Awaiting the submission is what advances the run; pi's own prompt() does too.
		const submission = await this.submit(content, whenBusy);
		const settled = await submission.wait(CONTEXT);
		// A run ended: read what the turn wrote, so the warmer evaluates a current branch, and
		// let the warmer decide whether to keep the entry warm (tasks 1.1, 3.3).
		await this.readChanges().catch(() => ({ entries: [], full: false }));
		this.#warming?.onSettled();
		// A run ended, so this session is the most recently used one (task 2.3).
		this.markActivity();
		const reason = unansweredReason(settled as { status?: string; reason?: string });
		this.#lastOutcome = reason === undefined ? { answered: true } : { answered: false, reason };
		if (reason !== undefined) this.#onFailure(outcomeLine(reason));
		return settled.status === "done";
	}

	/** The last assistant answer text (task 2.3). */
	async lastAssistantText(): Promise<string | undefined> {
		const records = await this.entries();
		const message = records.findLast((entry) => entry.kind === "pi.assistant")?.model?.[0] as
			| { readonly content?: unknown }
			| undefined;
		const content = message?.content;
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return undefined;
		const text = content.flatMap((block) => (block?.type === "text" ? [block.text] : [])).join("");
		return text.length === 0 ? undefined : text;
	}

	/** Append an append-only control-plane transition (task 5.2). */
	appendControl(data: ControlData): Promise<unknown> {
		return this.#conversation.commit(
			(tx) => tx.appendEntry(ControlEntry, this.#conversation.id, { data }),
			CONTEXT,
		);
	}

	/** The latest durable run policy (task 6.1). */
	/** The run policy the snapshot holds: a settings toggle reads no entry (task 2.2). */
	policy(): Policy {
		return this.#policy;
	}

	/** The run policy as stored, for the one caller that needs the stored value (the prime). */
	async storedPolicy(): Promise<Policy> {
		const latest = (await this.entries()).findLast((entry) => entry.kind === "harness.policy");
		return (latest?.data ?? {}) as Policy;
	}

	setPolicy(patch: Policy): Promise<unknown> {
		return this.#conversation.commit(
			(tx) => tx.appendEntry(PolicyEntry, this.#conversation.id, { data: patch }),
			CONTEXT,
		);
	}

	exportHtml(): Promise<string> {
		return this.entries().then((entries) => renderTranscriptHtml(entries));
	}

	async conversationIds(): Promise<readonly string[]> {
		const page = await this.#harness.commit((tx) => tx.scanConversations({}, 256, undefined), CONTEXT);
		return page.items.map((record) => String(record.id));
	}

	async fork(at: string): Promise<HarnessEngine> {
		const conversation = await this.#conversation.fork(at as never, { ownership: { kind: "ownerless" } }, CONTEXT);
		const forked = new HarnessEngine({
			harness: this.#harness,
			conversation,
			settingsManager: this.#settingsManager,
			modelRuntime: this.#modelRuntime,
			resources: this.#resources,
			registry: this.#registry,
			closeStorage: async () => {},
			...(this.#stamp === undefined ? {} : { stamp: this.#stamp }),
			modelScope: this.#modelScope,
			identity: this.#identity,
		});
		forked.#thinkingLevel = this.#thinkingLevel;
		return forked;
	}

	/**
	 * Continue the session from `at`, or from an empty transcript when it is null.
	 * Durable has no leaf to move, so the session moves into a fork of its first
	 * conversation, and the pointer is what makes a restart resume there.
	 */
	async rewind(at: string | number | null): Promise<string> {
		// Durable's entry ids are numbers; pi's are strings, so a caller may hand over
		// either, and anything else is a bug worth naming rather than forking on NaN.
		const entryId = at === null ? null : typeof at === "number" ? at : /^\d+$/.test(at) ? Number(at) : undefined;
		if (entryId === undefined) throw new Error(`rewind needs an entry id, got ${JSON.stringify(at)}`);
		const conversation =
			entryId === null
				? await this.#harness.createConversation({ ownership: { kind: "ownerless" } }, CONTEXT)
				: await this.#conversation.fork(entryId as never, { ownership: { kind: "ownerless" } }, CONTEXT);
		this.#warming?.cancel();
		this.#conversation = conversation;
		const id = String(conversation.id);
		await setCurrentConversation(this.#identity.config, this.#identity.key, id).catch(() => {});
		return id;
	}

	/** Return the session to its first conversation, dropping the pointer. */
	async unrewwind(): Promise<void> {
		await setCurrentConversation(this.#identity.config, this.#identity.key, undefined).catch(() => {});
	}

	async switchTo(id: string): Promise<boolean> {
		return this.switchConversation(id as never);
	}

	abort(): Promise<void> {
		return this.#conversation.abort(CONTEXT);
	}

	compact(instructions: string | undefined): Promise<unknown> {
		return this.#conversation.compact(instructions, CONTEXT);
	}

	async configure(change: AgentChange): Promise<void> {
		await this.#conversation.configure(change, CONTEXT);
		if (change.thinkingLevel != null) this.#thinkingLevel = change.thinkingLevel;
	}

	/**
	 * Attach the synchronous conversation observer (task 4.1). `advance` only
	 * forwards, so callers can enqueue and drain outside the observer.
	 */
	async watchEvents(): Promise<RevisionStream> {
		let listener: ((call: Revision) => void) | undefined;
		const backlog: Revision[] = [];
		const observation = await this.#harness.observeConversation(
			this.#conversation.id,
			{
				advance: (call) => {
					if (listener === undefined) backlog.push(call);
					else listener(call);
				},
				end: () => {},
			},
			CONTEXT,
		);
		return {
			value: observation.value,
			start: (next) => {
				listener = next;
				for (const call of backlog.splice(0)) next(call);
			},
			stop: async () => observation.detach(),
		};
	}

	/**
	 * Whether the session has no automatic work left: no live task and no queued
	 * or placed submission (task 4.5). `agent_settled` is emitted only then.
	 */
	async isQuiescent(): Promise<boolean> {
		const inspection = await this.#harness.inspect(CONTEXT);
		const live = inspection.tasks.length > 0;
		const queued = inspection.submissions.some((record) => record.status === "queued" || record.status === "placed");
		return !live && !queued;
	}

	switchConversation(id: ConversationId): Promise<boolean> {
		return this.#harness.conversation(id, CONTEXT).then((conversation) => {
			if (conversation === undefined) return false;
			this.#conversation = conversation;
			return true;
		});
	}

	async newConversation(): Promise<Conversation> {
		const conversation = await this.#harness.createConversation({ ownership: { kind: "ownerless" } }, CONTEXT);
		return conversation;
	}

	/** Whether a model is inside the `--models` scope; every model is without one. */
	inModelScope(provider: string, modelId: string): boolean {
		if (this.#modelScope.length === 0) return true;
		return this.#modelScope.some((entry) => entry.model.provider === provider && entry.model.id === modelId);
	}

	/**
	 * The models `get_available_models` and cycling may use: the scope when
	 * `--models` named one, otherwise every model with credentials.
	 */
	async availableModels(): Promise<readonly { readonly provider: string; readonly id: string; readonly name: string }[]> {
		if (this.#modelScope.length === 0) {
			const models = await this.#modelRuntime.getAllAvailable();
			return models.map((model) => ({ provider: model.provider, id: model.id, name: model.name }));
		}
		return this.#modelScope.map((entry) => ({
			provider: entry.model.provider,
			id: entry.model.id,
			name: entry.model.name,
		}));
	}

	/** Record that the session was used now (task 2.3). */
	markActivity(): void {
		// `-c` finds a session by `last_used`; a minute is stale enough for that and costs one
		// round trip per minute instead of one per turn (task 5.1).
		const now = Date.now();
		if (!shouldStamp({ now, stampedAt: this.#stampedAt })) return;
		this.#stampedAt = now;
		void this.#stamp?.().catch(() => {});
	}

	async close(): Promise<void> {
		// A refresh in flight stops with the session; a warm request outliving it would
		// write into a closed conversation.
		this.#warming?.cancel();
		await this.#harness.close(CONTEXT);
		await this.#closeStorage();
	}
}

function initialAgent(
	config: HarnessConfig,
	settingsManager: SettingsManager,
	modelRuntime: ModelRuntime,
	resolved?: Model<string>,
	resolvedThinking?: ModelThinkingLevel,
): AgentChange {
	const cwd = config.cwd;
	// `--model`/`--models`/`--api-key` already resolved through pi's own resolver.
	if (resolved !== undefined) {
		const level = resolvedThinking ?? (config.thinking as ModelThinkingLevel | undefined) ?? settingsManager.getDefaultThinkingLevel();
		return { cwd, model: { provider: resolved.provider, modelId: resolved.id }, ...(level === undefined ? {} : { thinkingLevel: level }) };
	}
	const thinking = config.thinking as ModelThinkingLevel | undefined;
	const provider = config.provider ?? settingsManager.getDefaultProvider();
	const modelId = config.model ?? settingsManager.getDefaultModel();
	if (provider === undefined || modelId === undefined) return { cwd };
	const model = modelRuntime.getModel(provider, modelId);
	if (model === undefined) return { cwd };
	const level = thinking ?? settingsManager.getDefaultThinkingLevel();
	return { cwd, model: { provider, modelId }, ...(level === undefined ? {} : { thinkingLevel: level }) };
}
