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
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
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
import { FileTools, CodemodeTools, PiCodingTools, platformShellTools } from "../tools/index.js";
import { configureCodemodeDescription } from "../tools/codemode.js";
import { type McpSettings } from "../tools/exposure.js";
import type { McpToolEntry } from "../tools/mcp.js";
import { setMcpEntries, exposureOf, isMcpTool } from "../tools/state.js";
import { isCallable } from "../tools/exposure.js";
import { toCodemodeIdentifier } from "@earendil-works/pi-codemode";
import { CODEMODE_OUTPUT_TYPES } from "../tools/pi-definitions.js";
import { computeActivation, computeDeclaredTools } from "../tools/activate.js";
import { ControlEntry, PolicyEntry, renderTranscriptHtml, type ControlData, type Policy } from "./projection.js";

const CONTEXT = BACKGROUND_CONTEXT;

/** Append pi's `Codemode:` line to a callable tool's description (task 5.6). */
function appendCodemodeLine(tool: import("@earendil-works/pi-durable").ToolRegistration): void {
	if (tool.name === "codemode" || tool.name === "tool_search") return;
	if (!isCallable(exposureOf(tool.name))) return;
	const resolves = isMcpTool(tool.name) ? "`CallToolResult`" : (CODEMODE_OUTPUT_TYPES[tool.name] ?? "a string");
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
	/** The MCP exposure table and settings that decide activation (tasks 1.3, 2.2). */
	readonly mcp?: { readonly entries: readonly McpToolEntry[]; readonly settings: McpSettings };
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
			registry.install(PiCodingTools);
			registry.install(FileTools);
			registry.install(platformShellTools());
			registry.install(CodemodeTools);
			registry.install(createPromptExtension(resources, options.mcp?.settings.servers ?? []));
			for (const extension of options.extraExtensions ?? []) registry.install(extension);

			// Exposure table (task 1.3); the composed codemode description needs the callable set, applied below.
			setMcpEntries(options.mcp?.entries ?? []);

			// Activation (task 2.2) and the explicit declared set (task 2.1).
			const defaultTools = (settingsManager.getSettings().defaultTools ?? []) as readonly string[];
			const activation = computeActivation(
				options.mcp?.settings.servers ?? [],
				options.mcp?.settings.autoEnableCodemode ?? true,
				defaultTools,
			);
			for (const warning of activation.warnings) process.stderr.write(`durable-rpc: ${warning}\n`);
			const declared = computeDeclaredTools(
				(
					registry.snapshot().tools() as readonly { readonly tool: import("@earendil-works/pi-durable").ToolRegistration }[]
				).map((entry) => entry.tool),
				activation,
				defaultTools,
			);
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
				const declaredNames = new Set(declared.map((tool) => tool.name));
				void declaredNames;
				configureCodemodeDescription(
					entryTools.filter((entry) => indirect.has(entry.tool.name)).map((entry) => entry.tool),
				);
			}
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
			const conversation = await harness.root(CONTEXT, { agent: { ...agent, tools: declared } });
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
