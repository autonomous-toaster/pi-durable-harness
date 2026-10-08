/**
 * The durable engine behind the RPC contract (tasks 3.3-3.5, 5.1-5.4, 6.1-6.4,
 * 7.5, 8.1). The session holds no state of its own beyond the durable policy
 * entry, so a restart reconstructs the same observable session.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { RpcSession } from "../rpc/protocol.js";
import { EventProjector } from "../harness/events.js";
import type { HarnessEngine } from "../harness/engine.js";
import { toUserContent } from "../harness/input.js";
import { projectEntries } from "../harness/projection.js";

const CONTEXT = BACKGROUND_CONTEXT;
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Environment variables pi injects into shell tool commands (task 7.5). */
export function shellEnvironment(
	agent: { model?: { provider: string; modelId: string } | undefined; thinkingLevel?: string },
	sessionId: string,
): Record<string, string> {
	return {
		AI_AGENT: "pi",
		PI_CODING_AGENT: "true",
		PI_SESSION_ID: sessionId,
		...(agent.model === undefined ? {} : { PI_PROVIDER: agent.model.provider, PI_MODEL: agent.model.modelId }),
		...(agent.thinkingLevel === undefined ? {} : { PI_REASONING_LEVEL: agent.thinkingLevel }),
	};
}

export class HarnessSession implements RpcSession {
	readonly #engine: HarnessEngine;
	readonly #key: string;
	#bashAbort: (() => void) | undefined;

	constructor(engine: HarnessEngine, key: string) {
		this.#engine = engine;
		this.#key = key;
	}

	get sessionId(): string {
		return this.#key;
	}

	async state(): Promise<Record<string, unknown>> {
		const agent = await this.#engine.resolvedAgent();
		const policy = await this.#engine.policy();
		const view = await this.#engine.view();
		const inbox = (view.docs["pi.inbox"] ?? {}) as { items?: unknown[] };
		return {
			model: agent.model === undefined ? null : { provider: agent.model.provider, id: agent.model.modelId },
			thinkingLevel: agent.thinkingLevel,
			isStreaming: false,
			isCompacting: false,
			steeringMode: policy.steeringMode ?? "all",
			followUpMode: policy.followUpMode ?? "one-at-a-time",
			sessionId: this.sessionId,
			sessionFile: null,
			autoCompactionEnabled: policy.autoCompaction ?? true,
			messageCount: view.entries.filter((entry) => entry.model !== undefined).length,
			pendingMessageCount: inbox.items?.length ?? 0,
		};
	}

	async submit(message: string, images: readonly unknown[] | undefined, behavior: "steer" | "followUp" | undefined) {
		const submission = await this.#engine.submit(toUserContent(message, images), behavior);
		const record = await submission.status(CONTEXT).catch(() => undefined);
		return { disposition: record?.status === "queued" ? "queued" : "started" };
	}

	abort(): Promise<void> {
		return this.#engine.abort();
	}

	async clearQueue(): Promise<void> {}

	async compact(instructions: string | undefined): Promise<void> {
		await this.#engine.compact(instructions);
	}

	async setAutoCompaction(enabled: boolean): Promise<void> {
		await this.#engine.setPolicy({ ...(await this.#engine.policy()), autoCompaction: enabled });
	}

	async setAutoRetry(enabled: boolean): Promise<void> {
		await this.#engine.setPolicy({ ...(await this.#engine.policy()), autoRetry: enabled });
	}

	async abortRetry(): Promise<void> {}

	async messages(): Promise<{ messages: unknown[] }> {
		return { messages: [...(await this.#engine.messages())] };
	}

	async entries(): Promise<{ entries: unknown[]; leafId: string | null }> {
		return projectEntries(await this.#engine.entries());
	}

	async tree(): Promise<{ tree: unknown; leafId: string | null }> {
		const { entries, leafId } = await this.entries();
		return { tree: entries, leafId };
	}

	async lastAssistantText(): Promise<{ text?: string }> {
		const records = await this.#engine.entries();
		const assistant = records.findLast((entry) => entry.kind === "pi.assistant");
		const message = assistant?.model?.[0] as { content?: unknown } | undefined;
		const content = message?.content;
		if (typeof content === "string") return { text: content };
		if (Array.isArray(content)) {
			const text = content.flatMap((block) => (block?.type === "text" ? [block.text] : [])).join("");
			return text.length === 0 ? {} : { text };
		}
		return {};
	}

	async sessionStats(): Promise<Record<string, unknown>> {
		const records = await this.#engine.entries();
		return {
			sessionId: this.sessionId,
			userMessages: records.filter((entry) => entry.kind === "pi.user").length,
			assistantMessages: records.filter((entry) => entry.kind === "pi.assistant").length,
			toolCalls: 0,
			toolResults: records.filter((entry) => entry.kind === "pi.tool-result").length,
			totalMessages: records.filter((entry) => entry.model !== undefined).length,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			cost: 0,
		};
	}

	async exportHtml(outputPath: string | undefined): Promise<{ path: string }> {
		const html = await this.#engine.exportHtml();
		const path = outputPath ?? join(await mkdtemp(join(tmpdir(), "durable-rpc-")), "session.html");
		await writeFile(path, html, "utf8");
		return { path };
	}

	async availableModels(): Promise<{ models: unknown[] }> {
		const models = await this.#engine.modelRuntime.getAllAvailable();
		return { models: models.map((model) => ({ provider: model.provider, id: model.id, name: model.name })) };
	}

	async setModel(provider: string, modelId: string): Promise<{ ok: boolean; error?: string }> {
		const model = this.#engine.modelRuntime.getModel(provider, modelId);
		if (model === undefined) return { ok: false, error: `Model not found: ${provider}/${modelId}` };
		await this.#engine.appendControl({ type: "model_change", provider, modelId });
		await this.#engine.configure({ model: { provider, modelId } });
		return { ok: true };
	}

	async cycleModel(): Promise<{ model: unknown }> {
		const models = await this.#engine.modelRuntime.getAllAvailable();
		const current = (await this.#engine.resolvedAgent()).model;
		const index = models.findIndex((model) => model.provider === current?.provider && model.id === current?.modelId);
		const next = models[(index + 1) % Math.max(models.length, 1)];
		if (next === undefined) return { model: current ?? null };
		await this.setModel(next.provider, next.id);
		return { model: { provider: next.provider, id: next.id } };
	}

	async setThinkingLevel(level: string): Promise<void> {
		if (!THINKING.includes(level as (typeof THINKING)[number])) throw new Error(`Unknown thinking level: ${level}`);
		await this.#engine.appendControl({ type: "thinking_level_change", level });
		await this.#engine.configure({ thinkingLevel: level as (typeof THINKING)[number] });
	}

	async cycleThinkingLevel(): Promise<{ level: string }> {
		const current = (await this.#engine.resolvedAgent()).thinkingLevel ?? "off";
		const next = THINKING[(THINKING.indexOf(current as (typeof THINKING)[number]) + 1) % THINKING.length] ?? "off";
		await this.setThinkingLevel(next);
		return { level: next };
	}

	async availableThinkingLevels(): Promise<{ levels: string[] }> {
		return { levels: [...THINKING] };
	}

	async setSteeringMode(mode: string): Promise<void> {
		await this.#engine.setPolicy({ ...(await this.#engine.policy()), steeringMode: mode as "all" | "one-at-a-time" });
	}

	async setFollowUpMode(mode: string): Promise<void> {
		await this.#engine.setPolicy({ ...(await this.#engine.policy()), followUpMode: mode as "all" | "one-at-a-time" });
	}

	async newSession(parentSession: string | undefined): Promise<{ canceled: boolean }> {
		const conversation = await this.#engine.newConversation();
		await this.#engine.switchTo(String(conversation.id));
		void parentSession;
		return { canceled: false };
	}

	async switchSession(sessionPath: string): Promise<{ canceled: boolean }> {
		const switched = await this.#engine.switchTo(sessionPath);
		if (!switched) throw new Error(`Unknown session: ${sessionPath}`);
		return { canceled: false };
	}

	async fork(entryId: string): Promise<{ text: string; canceled: boolean }> {
		const forked = await this.#engine.fork(entryId);
		return { text: String(forked.conversationId), canceled: false };
	}

	async clone(): Promise<{ canceled: boolean }> {
		const records = await this.#engine.entries();
		const last = records.at(-1);
		if (last === undefined) {
			const conversation = await this.#engine.newConversation();
			await this.#engine.switchTo(String(conversation.id));
			return { canceled: false };
		}
		const forked = await this.#engine.fork(String(last.id));
		await this.#engine.switchTo(String(forked.conversationId));
		return { canceled: false };
	}

	async getForkMessages(): Promise<{ messages: unknown[] }> {
		return { messages: [] };
	}

	async setSessionName(name: string): Promise<void> {
		await this.#engine.appendControl({ type: "session_info", name });
	}

	async bash(command: string, onOutput: (delta: string) => void): Promise<{ output: string; exitCode: number }> {
		const agent = await this.#engine.resolvedAgent();
		return new Promise((resolve, reject) => {
			const child = spawn(command, { shell: true, env: { ...process.env, ...shellEnvironment(agent, this.sessionId) } });
			let output = "";
			const emit = (chunk: Buffer): void => {
				const text = chunk.toString("utf8");
				output += text;
				onOutput(text);
			};
			child.stdout.on("data", emit);
			child.stderr.on("data", emit);
			this.#bashAbort = () => child.kill("SIGTERM");
			child.on("error", reject);
			child.on("close", (code) => {
				this.#bashAbort = undefined;
				resolve({ output, exitCode: code ?? 0 });
			});
		});
	}

	async abortBash(): Promise<void> {
		this.#bashAbort?.();
	}

	async getCommands(): Promise<{ commands: unknown[] }> {
		return { commands: [] };
	}

	async startEvents(sink: (record: unknown) => void): Promise<() => Promise<void>> {
		const stream = await this.#engine.watchEvents();
		const projector = new EventProjector(sink, () => this.#engine.isQuiescent());
		stream.start(async (events) => projector.handle(events));
		return async () => {
			await stream.stop();
		};
	}
}
