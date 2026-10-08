/**
 * Project durable agent events into pi's RPC event stream (tasks 4.1-4.6).
 *
 * Durable batches one event list per commit; pi emits individual records. The
 * internal `snapshot` is never forwarded — a client primes from `get_state` and
 * `get_messages`, matching pi's late-join behavior. `agent_settled` is
 * synthesized once the session is quiescent.
 */
import type { AgentEvent, EntryRecord, MessageChange } from "@earendil-works/pi-durable";

export type EventSink = (record: unknown) => void;

interface ToolProgress {
	text: string;
	details: unknown;
}

function assistantEvent(change: MessageChange): Record<string, unknown> | undefined {
	switch (change.type) {
		case "text_start":
		case "thinking_start":
		case "toolcall_start":
			return { type: change.type, contentIndex: change.contentIndex };
		case "text_delta":
		case "thinking_delta":
			return { type: change.type, contentIndex: change.contentIndex, delta: change.delta };
		case "toolcall_delta":
			return { type: "toolcall_delta", contentIndex: change.contentIndex, delta: change.delta };
		case "block": {
			const block = change.block as { type?: string; text?: string; thinking?: string; id?: string; name?: string };
			if (block.type === "text") return { type: "text_end", contentIndex: change.contentIndex, content: block.text ?? "" };
			if (block.type === "thinking")
				return { type: "thinking_end", contentIndex: change.contentIndex, content: block.thinking ?? "" };
			if (block.type === "toolCall")
				return { type: "toolcall_end", contentIndex: change.contentIndex, toolCall: change.block };
			return undefined;
		}
		case "message":
			return undefined;
	}
}

function firstMessage(entry: EntryRecord | undefined): unknown {
	return entry?.model?.[0];
}

export class EventProjector {
	readonly #sink: EventSink;
	readonly #isQuiescent: () => Promise<boolean>;
	readonly #progress = new Map<string, ToolProgress>();
	#settled = true;

	constructor(sink: EventSink, isQuiescent: () => Promise<boolean>) {
		this.#sink = sink;
		this.#isQuiescent = isQuiescent;
	}

	handle(events: readonly AgentEvent[]): void {
		for (const event of events) this.#one(event);
	}

	#one(event: AgentEvent): void {
		switch (event.type) {
			case "snapshot":
				return;
			case "run_start":
				this.#settled = false;
				this.#sink({ type: "agent_start" });
				return;
			case "run_end":
				this.#sink({ type: "agent_end", messages: [], willRetry: false });
				void this.#settle();
				return;
			case "turn_start":
				this.#sink({ type: "turn_start" });
				return;
			case "turn_end":
				this.#sink({ type: "turn_end", message: undefined, toolResults: [] });
				return;
			case "message_start":
				this.#sink({ type: "message_start", message: event.message });
				return;
			case "message_update":
				for (const change of event.changes) {
					const nested = assistantEvent(change);
					if (nested !== undefined) this.#sink({ type: "message_update", usage: event.usage, assistantMessageEvent: nested });
				}
				return;
			case "message_end":
				this.#sink({ type: "message_end", message: firstMessage(event.entry) });
				return;
			case "tool_execution_start":
				this.#progress.set(event.toolCallId, { text: "", details: undefined });
				this.#sink({ type: "tool_execution_start", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
				return;
			case "tool_execution_update": {
				const slot = this.#progress.get(event.toolCallId) ?? { text: "", details: undefined };
				if (event.output !== undefined) {
					if ("set" in event.output) slot.text = event.output.set;
					else slot.text = (event.output.trimStart === undefined ? slot.text : slot.text.slice(event.output.trimStart)) + (event.output.append ?? "");
				}
				if (event.details !== undefined) slot.details = event.details;
				this.#progress.set(event.toolCallId, slot);
				this.#sink({
					type: "tool_execution_update",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					partialResult: { content: [{ type: "text", text: slot.text }], details: slot.details ?? {} },
				});
				return;
			}
			case "tool_execution_end": {
				this.#progress.delete(event.toolCallId);
				const message = firstMessage(event.entry) as { content?: unknown; isError?: boolean } | undefined;
				this.#sink({
					type: "tool_execution_end",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					result: message ?? undefined,
					isError: message?.isError === true,
				});
				return;
			}
			case "inbox_update":
				this.#sink({
					type: "queue_update",
					steering: event.items.filter((item) => item.mode === "steer").map((item) => item.id),
					followUp: event.items.filter((item) => item.mode === "followUp").map((item) => item.id),
				});
				return;
			case "entry_appended":
				this.#sink({ type: "entry_appended", entry: event.entry });
				return;
			case "compaction_start":
				this.#sink({ type: "compaction_start", reason: event.reason });
				return;
			case "compaction_end":
				this.#sink({ type: "compaction_end", reason: event.reason });
				return;
			case "auto_retry_start":
				this.#sink({ type: "auto_retry_start", attempt: event.attempt, maxAttempts: 0, delayMs: 0, errorMessage: event.errorMessage });
				return;
			case "auto_retry_end":
				this.#sink({ type: "auto_retry_end", success: true, attempt: event.attempt });
				return;
			case "agent_changed": {
				if (event.agent.thinkingLevel !== undefined) {
					this.#sink({ type: "thinking_level_changed", level: event.agent.thinkingLevel });
				}
				return;
			}
			default:
				return;
		}
	}

	async #settle(): Promise<void> {
		if (this.#settled) return;
		if (await this.#isQuiescent()) {
			this.#settled = true;
			this.#sink({ type: "agent_settled" });
		}
	}
}
