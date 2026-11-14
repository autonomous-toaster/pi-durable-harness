/**
 * What one refresh reads (tasks 1.1, 1.2, 2.1-2.3, 3.1).
 *
 * The rule this module encodes: an idle client asks one question (the newest entry id)
 * and reads nothing else; a change reads the entries written since the last read; a
 * branch that moved backwards is read whole. Every decision is a pure function, so the
 * read economy is asserted in a test rather than measured on a wire.
 */

/** What the snapshot held the last time the session read its storage. */
export interface SnapshotCursor {
	/** Newest entry id held, or `undefined` before the first read. */
	readonly newestEntryId?: number | string;
	/** Number of entries held, for the entry count a status answer reports. */
	readonly entryCount: number;
	/** Number of those entries that carry a message, which is what a status answer names. */
	readonly messageCount: number;
}

/** One decision: read nothing, read the delta, or read the branch whole. */
export type ReadPlan =
	| { readonly kind: "none"; readonly probe: number | string | undefined }
	| { readonly kind: "delta"; readonly probe: number | string | undefined; readonly after: number | string }
	| { readonly kind: "full"; readonly probe: number | string | undefined };

/**
 * Decide what to read, given the probed newest id and what the snapshot already holds.
 *
 * - The probe is the newest entry id, and it is the only statement an idle poll issues.
 * - A probe equal to the held id means nothing was written: read no record.
 * - A probe above the held id means entries were appended: read from the held id.
 * - A probe below the held id, or no held id at all, means the branch restarted (a rewind,
 *   a fork, a fresh process): read the branch whole.
 * - A missing probe (the read failed or the session is empty) reads nothing, so a failing
 *   probe cannot turn into a transcript scan.
 */
export function planRead(probe: number | string | undefined, cursor: SnapshotCursor): ReadPlan {
	if (probe === undefined) return { kind: "none", probe };
	const held = cursor.newestEntryId;
	if (held === undefined) return { kind: "full", probe };
	if (String(probe) === String(held)) return { kind: "none", probe };
	// Ids are numeric in durable; compare as numbers and fall back to strings.
	const probeId = Number(probe);
	const heldId = Number(held);
	if (Number.isFinite(probeId) && Number.isFinite(heldId) && probeId > heldId) return { kind: "delta", probe, after: held };
	if (!Number.isFinite(probeId) || !Number.isFinite(heldId)) return { kind: "full", probe };
	return { kind: "full", probe };
}

/** The cursor that follows a read: the newest id and the count now held. */
export function advanceCursor(entries: readonly unknown[], previous: SnapshotCursor): SnapshotCursor {
	let newest = previous.newestEntryId;
	let count = previous.entryCount;
	let messages = previous.messageCount;
	for (const entry of entries) {
		const id = (entry as { readonly id?: number | string }).id;
		if (id === undefined) continue;
		count += 1;
		if ((entry as { readonly model?: readonly unknown[] }).model !== undefined) messages += 1;
		if (newest === undefined || Number(id) > Number(newest)) newest = id;
	}
	return newest === undefined ? { entryCount: count, messageCount: messages } : { newestEntryId: newest, entryCount: count, messageCount: messages };
}

/**
 * Whether a delta makes the cached message list unusable. A compaction entry rewrites what
 * the context holds, so the session asks the storage for the branch rather than appending
 * (tasks 2.2, 2.3).
 */
export function rewritesContext(entries: readonly unknown[]): boolean {
	return entries.some((entry) => (entry as { readonly kind?: string }).kind === "pi.compaction");
}

/** The messages a delta appends to the context, in order. */
export function appendedMessages(entries: readonly unknown[]): readonly unknown[] {
	const messages: unknown[] = [];
	for (const entry of entries) {
		const kind = (entry as { readonly kind?: string }).kind;
		if (kind !== "pi.user" && kind !== "pi.assistant" && kind !== "pi.tool-result") continue;
		const message = (entry as { readonly model?: readonly unknown[] }).model?.[0];
		if (message !== undefined) messages.push(message);
	}
	return messages;
}

/**
 * The last answer the messages carry, without another storage read (task 2.2). The newest
 * assistant message decides: a call with no text after it has no answer, exactly as the
 * stored-transcript read answered before.
 */
export function lastAnswerOf(messages: readonly unknown[]): string | undefined {
	const message = messages.findLast((entry) => (entry as { readonly role?: string }).role === "assistant") as
		| { readonly content?: unknown }
		| undefined;
	if (message === undefined) return undefined;
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const text = content.flatMap((block) => ((block as { type?: string }).type === "text" ? [(block as { text: string }).text] : [])).join("");
	return text.length === 0 ? undefined : text;
}
