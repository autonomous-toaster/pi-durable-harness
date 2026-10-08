/**
 * The durable engine: one Harness over one session, wired from pi's loaded
 * resources (tasks 3.4, 8.1, 8.2).
 */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	Harness,
	MemoryStorage,
	type AgentChange,
	type AgentEventStream,
	type Conversation,
	type ConversationId,
	type ConversationView,
	type EntryRecord,
	type HarnessSettings,
	type ModelRef,
	type Storage,
	type Submission,
	watchEvents,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
	DefaultResourceLoader,
	ModelRuntime,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Pool } from "pg";
import pg from "pg";
import { openPostgresStorage } from "../storage/postgres/storage.js";
import type { HarnessConfig } from "./config.js";
import { createHarnessSettings } from "./settings.js";
import { createPromptExtension, type PromptResources } from "./prompt.js";
import { FileTools, CodemodeTools, platformShellTools } from "../tools/index.js";
import { ControlEntry, PolicyEntry, renderTranscriptHtml, type ControlData, type Policy } from "./projection.js";

const CONTEXT = BACKGROUND_CONTEXT;

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

function identifier(key: string): string {
	const slug = key.toLowerCase().replaceAll(/[^a-z0-9_]/g, "_").slice(0, 40);
	const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
	return `s_${slug}_${digest}`;
}

async function openStorage(config: HarnessConfig, key: string): Promise<{ storage: Storage; close(): Promise<void> }> {
	if (config.ephemeral) {
		return { storage: new MemoryStorage(), close: async () => {} };
	}
	if (config.databaseUrl !== undefined) {
		const pool: Pool = new pg.Pool({ connectionString: config.databaseUrl });
		const storage = await openPostgresStorage({ pool, schema: identifier(key) });
		return {
			storage,
			close: async () => {
				await storage.close(CONTEXT);
				await pool.end();
			},
		};
	}
	const path = join(config.sessionDir, `${identifier(key)}.sqlite`);
	await mkdir(dirname(path), { recursive: true });
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
}

export class HarnessEngine {
	readonly #harness: Harness;
	readonly #settingsManager: SettingsManager;
	readonly #modelRuntime: ModelRuntime;
	readonly #closeStorage: () => Promise<void>;
	#conversation: Conversation;

	private constructor(options: {
		harness: Harness;
		conversation: Conversation;
		settingsManager: SettingsManager;
		modelRuntime: ModelRuntime;
		closeStorage: () => Promise<void>;
	}) {
		this.#harness = options.harness;
		this.#conversation = options.conversation;
		this.#settingsManager = options.settingsManager;
		this.#modelRuntime = options.modelRuntime;
		this.#closeStorage = options.closeStorage;
	}

	static async open(options: HarnessEngineOptions): Promise<HarnessEngine> {
		const { config, key, modelRuntime, settingsManager, resources } = options;
		const opened = await openStorage(config, key);
		try {
			const settings: HarnessSettings = createHarnessSettings(settingsManager);
			const registry = (await import("@earendil-works/pi-durable")).createRegistry();
			registry.install(CodingTools);
			registry.install(FileTools);
			registry.install(platformShellTools());
			registry.install(CodemodeTools);
			registry.install(createPromptExtension(resources));
			for (const extension of options.extraExtensions ?? []) registry.install(extension);
			const envs = new ExecutionEnvs(config.cwd);
			const harness = await Harness.open(
				opened.storage,
				{
					models: modelRuntime,
					registry,
					settings,
					env: envs.env,
					onReport: () => {},
				},
				CONTEXT,
			);
			const agent = initialAgent(config, settingsManager, modelRuntime);
			const conversation = await harness.root(CONTEXT, { agent });
			harness.resume();
			return new HarnessEngine({
				harness,
				conversation,
				settingsManager,
				modelRuntime,
				closeStorage: opened.close,
			});
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

	messages(): Promise<readonly unknown[]> {
		return this.#conversation.context(CONTEXT).then((view) => view.messages);
	}

	currentModel(): ModelRef | undefined {
		return undefined;
	}

	resolvedAgent(): Promise<Awaited<ReturnType<Conversation["agent"]>>> {
		return this.#conversation.agent(CONTEXT);
	}

	view(): Promise<ConversationView> {
		return this.#conversation.viewState(CONTEXT).then((state) => state.value);
	}

	entries(limit = 512): Promise<readonly EntryRecord[]> {
		return this.#conversation.entries({ order: "ascending" }, limit, undefined, CONTEXT).then((page) => page.items);
	}

	submit(content: string | readonly unknown[], whenBusy?: "steer" | "followUp" | "reject"): Promise<Submission> {
		return this.#conversation.submit(
			whenBusy === undefined
				? { type: "input", content: content as never }
				: { type: "input", content: content as never, whenBusy },
			CONTEXT,
		);
	}

	/** Append an append-only control-plane transition (task 5.2). */
	appendControl(data: ControlData): Promise<unknown> {
		return this.#conversation.commit(
			(tx) => tx.appendEntry(ControlEntry, this.#conversation.id, { data }),
			CONTEXT,
		);
	}

	/** The latest durable run policy (task 6.1). */
	async policy(): Promise<Policy> {
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
		return new HarnessEngine({
			harness: this.#harness,
			conversation,
			settingsManager: this.#settingsManager,
			modelRuntime: this.#modelRuntime,
			closeStorage: async () => {},
		});
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

	configure(change: AgentChange): Promise<void> {
		return this.#conversation.configure(change, CONTEXT);
	}

	watchEvents(): Promise<AgentEventStream> {
		return watchEvents(this.#harness, this.#conversation.id, CONTEXT);
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

	async close(): Promise<void> {
		await this.#harness.close(CONTEXT);
		await this.#closeStorage();
	}
}

function initialAgent(
	config: HarnessConfig,
	settingsManager: SettingsManager,
	modelRuntime: ModelRuntime,
): AgentChange {
	const cwd = config.cwd;
	const thinking = config.thinking as ModelThinkingLevel | undefined;
	const provider = config.provider ?? settingsManager.getDefaultProvider();
	const modelId = config.model ?? settingsManager.getDefaultModel();
	if (provider === undefined || modelId === undefined) return { cwd };
	const model = modelRuntime.getModel(provider, modelId);
	if (model === undefined) return { cwd };
	const level = thinking ?? settingsManager.getDefaultThinkingLevel();
	return { cwd, model: { provider, modelId }, ...(level === undefined ? {} : { thinkingLevel: level }) };
}
