/**
 * S1 transcript projection: durable entries are canonical and are projected
 * into pi's `SessionEntry` shapes at the RPC boundary (tasks 5.1, 5.3, 5.4).
 *
 * Control-plane transitions (model change, thinking level, session info,
 * label) are stored as an append-only durable entry kind so the projection
 * reconstructs them at their original position (task 5.2) instead of inferring
 * them from current state. Entry kinds this adapter does not know are returned
 * verbatim as `custom` entries (task 5.3).
 */
import { defineEntry, type EntryRecord } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";

export type ControlData =
	| { readonly type: "model_change"; readonly provider: string; readonly modelId: string }
	| { readonly type: "thinking_level_change"; readonly level: string }
	| { readonly type: "session_info"; readonly name?: string }
	| { readonly type: "label"; readonly label: string };

/** Append-only control-plane history (task 5.2). */
export const ControlEntry = defineEntry<ControlData>("harness.control");

/** Per-session run policy persisted durably (task 6.1). The latest entry wins. */
export type Policy = {
	readonly [key: string]: JsonValue;
	readonly steeringMode?: "all" | "one-at-a-time";
	readonly followUpMode?: "all" | "one-at-a-time";
	readonly autoCompaction?: boolean;
	readonly autoRetry?: boolean;
};
export const PolicyEntry = defineEntry<Policy>("harness.policy");

/** The pi session-format version this projection targets (task 5.1). */
export const PROJECTION_VERSION = 3;

function messageEntry(entry: EntryRecord, parentId: string | null): Record<string, unknown> {
	return { id: String(entry.id), parentId, type: "message", message: entry.model?.[0] };
}

function controlEntry(entry: EntryRecord, parentId: string | null, data: ControlData): Record<string, unknown> {
	const base = { id: String(entry.id), parentId };
	switch (data.type) {
		case "model_change":
			return { ...base, type: "model_change", provider: data.provider, modelId: data.modelId };
		case "thinking_level_change":
			return { ...base, type: "thinking_level_change", level: data.level };
		case "session_info":
			return { ...base, type: "session_info", name: data.name };
		case "label":
			return { ...base, type: "label", label: data.label };
	}
}

/** Project one durable entry into a pi session entry. */
export function projectEntry(entry: EntryRecord, parentId: string | null): Record<string, unknown> {
	switch (entry.kind) {
		case "pi.user":
		case "pi.assistant":
		case "pi.tool-result":
			return messageEntry(entry, parentId);
		case "pi.compaction": {
			const data = (entry.data ?? {}) as { summary?: string; firstKeptEntryId?: unknown; tokensBefore?: number };
			return {
				id: String(entry.id),
				parentId,
				type: "compaction",
				summary: data.summary ?? "",
				firstKeptEntryId: data.firstKeptEntryId === undefined ? null : String(data.firstKeptEntryId),
				tokensBefore: data.tokensBefore ?? 0,
			};
		}
		case "harness.control":
			return controlEntry(entry, parentId, entry.data as ControlData);
		default:
			// Unknown and future kinds are preserved verbatim (task 5.3).
			return { id: String(entry.id), parentId, type: "custom", customType: entry.kind, data: entry.data ?? null };
	}
}

export function projectEntries(entries: readonly EntryRecord[]): { entries: unknown[]; leafId: string | null } {
	let parent: string | null = null;
	const projected = entries.map((entry) => {
		const value = projectEntry(entry, parent);
		parent = String(entry.id);
		return value;
	});
	return { entries: projected, leafId: parent };
}

function escapeHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (block?.type === "text") return block.text;
			if (block?.type === "image") return "[image]";
			if (block?.type === "thinking") return "";
			return "";
		})
		.join("");
}

/** Render a transcript as standalone HTML covering messages, tool calls, and results (task 5.4). */
export function renderTranscriptHtml(entries: readonly EntryRecord[]): string {
	const blocks = entries
		.filter((entry) => entry.model !== undefined)
		.map((entry) => {
			const message = entry.model?.[0] as { role?: string; content?: unknown } | undefined;
			const role = message?.role ?? entry.kind;
			const calls = Array.isArray(message?.content)
				? message.content.filter((block) => block?.type === "toolCall")
				: [];
			const callHtml = calls
				.map((call) => `<pre class="call">${escapeHtml(call.name)} ${escapeHtml(JSON.stringify(call.arguments))}</pre>`)
				.join("");
			return `<section class="${escapeHtml(role)}"><h2>${escapeHtml(role)}</h2><p>${escapeHtml(contentText(message?.content))}</p>${callHtml}</section>`;
		})
		.join("\n");
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Session transcript</title></head>
<body>
<h1>Session transcript</h1>
${blocks}
</body></html>
`;
}
