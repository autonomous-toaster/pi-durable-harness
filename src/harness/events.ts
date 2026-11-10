/**
 * Project Durable's conversation state into pi's RPC event stream (tasks 4.1-4.6).
 *
 * `watchEvents()` and its `AgentEvent` types are gone in pi-durable 1.5.2. The
 * replacement is a synchronous `Harness.observeConversation()` observer, which
 * delivers every change unfolded, plus the JSON-diff operations that turn the
 * previous view into the newest one (task 4.7). This module routes those
 * operations back into the records pi's RPC client expects.
 *
 * The observer contract forbids awaiting, calling the Session, or throwing
 * inside `advance`, so it only enqueues. `RevisionQueue` drains outside the
 * observer, in order (task 4.8).
 *
 * Payloads come from `call.value`; the operations decide which records to emit
 * and carry the appended text. That keeps a replacement op or a missing op list
 * from losing data.
 */
import type { Op } from "@earendil-works/chord/delta";
import type { ConversationView, EntryRecord, LiveState, WatchCall } from "@earendil-works/pi-durable";
import { projectEntry } from "./projection.js";

export type EventSink = (record: unknown) => void;

/** One listener call, as Durable hands it to a synchronous observer. */
export type Revision = WatchCall<ConversationView>;

/** Attached revision source: the acquisition value, a listener, and a detach. */
export interface RevisionStream {
	readonly value: ConversationView;
	start(listener: (call: Revision) => void): void;
	stop(): Promise<void>;
}

type Json = Record<string, unknown>;

/** The record family an operation path belongs to (task 4.7). */
type PathFamily = "entries" | "lifecycle" | "generation" | "tools" | "compaction" | "inbox" | "agent" | "all";

function isRecord(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function liveOf(view: ConversationView): LiveState {
	const live = view.docs["pi.live"];
	return isRecord(live) ? (live as unknown as LiveState) : {};
}

/** Classify one operation by its path prefix. */
function familyOf(op: Op): PathFamily {
	if (op[0] === "r") return "all";
	const path = op[1] as readonly (string | number)[];
	if (path[0] === "entries") return "entries";
	if (path[0] !== "docs") return "all";
	switch (path[1]) {
		case "pi.inbox":
			return "inbox";
		case "pi.agent":
			return "agent";
		case "pi.live":
			switch (path[2]) {
				case "run":
					return "lifecycle";
				case "generation":
					return "generation";
				case "tools":
				case "nestedTools":
					return "tools";
				case "compactions":
				case "compactionFailure":
					return "compaction";
				default:
					return "generation";
			}
		default:
			return "all";
	}
}

function familiesOf(ops: readonly Op[]): Set<PathFamily> {
	if (ops.length === 0) return new Set<PathFamily>(["all"]);
	const families = new Set<PathFamily>();
	for (const op of ops) families.add(familyOf(op));
	return families;
}

/** Appended text of a `["a", path, text]` op at the given content index. */
function appendedAt(ops: readonly Op[], contentIndex: number, field: string): string[] {
	const parts: string[] = [];
	for (const op of ops) {
		if (op[0] !== "a") continue;
		const path = op[1] as readonly (string | number)[];
		const at = path.indexOf("content");
		if (at === -1 || path[at + 1] !== contentIndex) continue;
		if (path[at + 2] !== field) continue;
		parts.push(op[2]);
	}
	return parts;
}

type BlockKind = "text" | "thinking" | "toolcall";

/** The usage block pi attaches to every `message_update`. */
const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** The block family of one assistant content block, or undefined for an unknown kind. */
function blockKind(block: Json): BlockKind | undefined {
	if (block.type === "text") return "text";
	if (block.type === "thinking") return "thinking";
	if (block.type === "toolCall") return "toolcall";
	return undefined;
}

/** The streamed text of a block: its text, its thinking, or its serialized arguments. */
function blockText(block: Json): string {
	if (typeof block.text === "string") return block.text;
	if (typeof block.thinking === "string") return block.thinking;
	if (block.type === "toolCall") return JSON.stringify(block.arguments ?? {});
	return "";
}

/** The tool arguments of a model-issued call, from its assistant entry. */
function toolArguments(entries: readonly EntryRecord[], callId: string): unknown {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const message = entries[index]?.model?.[0] as Json | undefined;
		const content = Array.isArray(message?.content) ? (message.content as readonly Json[]) : [];
		for (const block of content) {
			if (block.type === "toolCall" && block.id === callId) return block.arguments;
		}
	}
	return undefined;
}

/**
 * Turns revisions into pi records (tasks 4.1-4.7).
 */
export class EventProjector {
	readonly #sink: EventSink;
	readonly #isQuiescent: () => Promise<boolean>;
	#settled = true;
	#running = false;
	#turn = -1;
	#turnOpen = false;
	#seenEntries: string[] = [];
	#startedTools = new Set<string>();
	#inboxKey = JSON.stringify([[], []]);
	#compactions = new Set<string>();

	constructor(sink: EventSink, isQuiescent: () => Promise<boolean>) {
		this.#sink = sink;
		this.#isQuiescent = isQuiescent;
	}

	/** Seed from the acquisition value so no snapshot replays (task 4.6). */
	seed(view: ConversationView): void {
		this.#seenEntries = view.entries.map((entry) => String(entry.id));
		const live = liveOf(view);
		this.#running = live.run !== undefined;
	}

	/** Handle one revision. May await Session reads. */
	async handle(call: Revision): Promise<void> {
		if (call.kind !== "value") return;
		const view = call.value;
		const live = liveOf(view);
		const families = familiesOf(call.ops);

		if (families.has("all") || families.has("entries")) this.#projectEntries(view);
		if (families.has("all") || families.has("generation")) this.#projectGeneration(live, call.ops);
		if (families.has("all") || families.has("tools")) this.#projectTools(view, live);
		if (families.has("all") || families.has("inbox")) this.#projectInbox(view);
		if (families.has("all") || families.has("compaction")) this.#projectCompactions(live);

		this.#projectLifecycle(live);
		if (!this.#running) await this.#settle();
	}

	/** Emit `entry_appended` and the message pair for each new entry (task 4.2). */
	#projectEntries(view: ConversationView): void {
		const seen = new Set(this.#seenEntries);
		for (const entry of view.entries) {
			const id = String(entry.id);
			if (seen.has(id)) continue;
			this.#seenEntries.push(id);
			seen.add(id);
			const projected = projectEntry(entry, null);
			const message = (projected as { message?: Json }).message;
			if (message !== undefined) {
				if (message.role === "assistant") this.#closeAssistant(message);
				else {
					this.#sink({ type: "message_start", message });
					this.#sink({ type: "message_end", message });
				}
			}
			this.#sink({ type: "entry_appended", entry });
		}
	}

	/** Blocks of the assistant message in flight, so `*_start`/`*_end` bracket the deltas. */
	#blocks = new Map<number, { kind: BlockKind; length: number }>();
	#usage: Json = EMPTY_USAGE;
	#lastAssistant: Json = {};
	#assistantOpen = false;
	#liveDeltas = false;

	/** Open the assistant message and emit the growth of each content block. */
	#projectGeneration(live: LiveState, ops: readonly Op[]): void {
		const generation = live.generation;
		if (generation?.message === undefined) return;
		const message = generation.message as Json;
		if (isRecord(message.usage)) this.#usage = message.usage;
		this.#lastAssistant = message;
		if (!this.#assistantOpen) {
			this.#assistantOpen = true;
			this.#sink({ type: "message_start", message });
		}
		const content = Array.isArray(message.content) ? (message.content as readonly Json[]) : [];
		content.forEach((block, contentIndex) => {
			const kind = blockKind(block);
			if (kind === undefined) return;
			let state = this.#blocks.get(contentIndex);
			if (state === undefined || state.kind !== kind) {
				state = { kind, length: 0 };
				this.#blocks.set(contentIndex, state);
				this.#sink({ type: "message_update", usage: this.#usage, assistantMessageEvent: { type: `${kind}_start`, contentIndex } });
			}
			const text = blockText(block);
			const appended = appendedAt(ops, contentIndex, kind === "toolcall" ? "input" : kind);
			const delta = appended.length > 0 ? appended.join("") : text.slice(state.length);
			if (delta.length > 0) {
				this.#liveDeltas = true;
				this.#sink({ type: "message_update", usage: this.#usage, assistantMessageEvent: { type: `${kind}_delta`, contentIndex, delta } });
			}
			state.length = text.length;
		});
	}

	/** Close the open blocks and the message, or synthesize the pair when nothing streamed. */
	#closeAssistant(message: Json): void {
		if (isRecord(message.usage)) this.#usage = message.usage;
		this.#lastAssistant = message;
		if (this.#assistantOpen) {
			for (const [contentIndex, state] of this.#blocks) {
				this.#sink({ type: "message_update", usage: this.#usage, assistantMessageEvent: { type: `${state.kind}_end`, contentIndex } });
			}
			this.#blocks.clear();
			this.#assistantOpen = false;
			this.#liveDeltas = false;
			this.#sink({ type: "message_end", message });
			return;
		}
		// An atomic provider answer: replay the start, delta, and end pi always emits.
		this.#sink({ type: "message_start", message });
		const content = Array.isArray(message.content) ? (message.content as readonly Json[]) : [];
		content.forEach((block, contentIndex) => {
			const kind = blockKind(block);
			if (kind === undefined) return;
			const text = blockText(block);
			this.#sink({ type: "message_update", usage: this.#usage, assistantMessageEvent: { type: `${kind}_start`, contentIndex } });
			if (text.length > 0) {
				this.#sink({ type: "message_update", usage: this.#usage, assistantMessageEvent: { type: `${kind}_delta`, contentIndex, delta: text } });
			}
			this.#sink({ type: "message_update", assistantMessageEvent: { type: `${kind}_end`, contentIndex } });
		});
		this.#sink({ type: "message_end", message });
	}

	/** Emit tool start, update, and end from the live slots (task 4.3). */
	#projectTools(view: ConversationView, live: LiveState): void {
		const slots = live.tools ?? [];
		for (const slot of slots) {
			const callId = String(slot.callId);
			const name = String(slot.name ?? "");
			if (slot.status === "pending" || slot.status === "running") {
				if (!this.#startedTools.has(callId)) {
					this.#startedTools.add(callId);
					this.#sink({
						type: "tool_execution_start",
						toolCallId: callId,
						toolName: name,
						args: toolArguments(view.entries, callId),
					});
				}
				if (typeof slot.output === "string" && slot.output.length > 0) {
					this.#sink({
						type: "tool_execution_update",
						toolCallId: callId,
						toolName: name,
						args: toolArguments(view.entries, callId),
						partialResult: { content: [{ type: "text", text: slot.output }], details: slot.details ?? {} },
					});
				}
				continue;
			}
			if (slot.status === "done") {
				if (!this.#startedTools.has(callId)) {
					this.#startedTools.add(callId);
					this.#sink({
						type: "tool_execution_start",
						toolCallId: callId,
						toolName: name,
						args: toolArguments(view.entries, callId),
					});
				}
				if (this.#startedTools.delete(callId)) {
					const entry = view.entries.find((candidate) => String(candidate.id) === String(slot.entry));
					const message = entry?.model?.[0] as { isError?: boolean; durationMs?: number } | undefined;
					this.#sink({
						type: "tool_execution_end",
						toolCallId: callId,
						toolName: name,
						result: message,
						isError: message?.isError === true,
						durationMs: message?.durationMs,
					});
				}
			}
		}
	}

	/** Emit `queue_update` when the inbox changes (task 4.2). */
	#projectInbox(view: ConversationView): void {
		const inbox = view.docs["pi.inbox"];
		const items = isRecord(inbox) && Array.isArray(inbox.items) ? (inbox.items as readonly Json[]) : [];
		const steering = items.filter((item) => item.mode === "steer").map((item) => item.id);
		const followUp = items.filter((item) => item.mode === "followUp").map((item) => item.id);
		const key = JSON.stringify([steering, followUp]);
		if (key === this.#inboxKey) return;
		this.#inboxKey = key;
		this.#sink({ type: "queue_update", steering, followUp });
	}

	/** Emit the compaction pair (task 4.4). */
	#projectCompactions(live: LiveState): void {
		const states = live.compactions ?? [];
		const active = new Set(states.map((status) => String(status.taskId)));
		for (const status of states) {
			const id = String(status.taskId);
			if (this.#compactions.has(id)) continue;
			this.#compactions.add(id);
			this.#sink({ type: "compaction_start", reason: status.trigger });
		}
		for (const id of [...this.#compactions]) {
			if (active.has(id)) continue;
			this.#compactions.delete(id);
			this.#sink({ type: "compaction_end", reason: live.compactionFailure?.trigger });
		}
	}

	/** Emit the lifecycle and turn boundaries (tasks 4.1, 4.5). */
	#projectLifecycle(live: LiveState): void {
		const run = live.run;
		if (run !== undefined && !this.#running) {
			this.#running = true;
			this.#settled = false;
			this.#sink({ type: "agent_start" });
		}
		if (run === undefined) {
			if (this.#turnOpen) {
				this.#turnOpen = false;
				this.#sink({ type: "turn_end", message: this.#lastAssistant, toolResults: [] });
			}
			if (this.#running) {
				this.#running = false;
				this.#sink({ type: "agent_end", messages: [], willRetry: false });
			}
			return;
		}
		const turns = typeof run.turns === "number" ? run.turns : 0;
		if (turns !== this.#turn) {
			if (this.#turnOpen) this.#sink({ type: "turn_end", message: this.#lastAssistant, toolResults: [] });
			this.#turn = turns;
			this.#turnOpen = true;
			this.#sink({ type: "turn_start" });
		}
	}

	/** Emit `agent_settled` once the session is quiescent (task 4.5). */
	async #settle(): Promise<void> {
		if (this.#settled) return;
		if (await this.#isQuiescent()) {
			this.#settled = true;
			this.#sink({ type: "agent_settled", aborted: false });
		}
	}
}

/**
 * Record-and-drain wrapper around the observer (task 4.8). `push` only
 * enqueues, so it is safe inside `Observer.advance`.
 */
export class RevisionQueue {
	readonly #projector: EventProjector;
	readonly #pending: Revision[] = [];
	#draining = false;

	constructor(projector: EventProjector) {
		this.#projector = projector;
	}

	push(call: Revision): void {
		this.#pending.push(call);
		void this.#drain();
	}

	async #drain(): Promise<void> {
		if (this.#draining) return;
		this.#draining = true;
		try {
			while (this.#pending.length > 0) {
				const call = this.#pending.shift();
				if (call !== undefined) await this.#projector.handle(call);
			}
		} finally {
			this.#draining = false;
		}
	}

	/** Resolve once the queue is empty. */
	async idle(): Promise<void> {
		while (this.#draining || this.#pending.length > 0) await new Promise((resolve) => setTimeout(resolve, 0));
	}
}
