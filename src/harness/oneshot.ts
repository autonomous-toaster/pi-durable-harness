/**
 * One-shot CLI modes (tasks 2.2-2.4): run the positional prompts and then write
 * the output, matching pi's `--print` and `--mode json`.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Writable } from "node:stream";
import type { AgentEventStream } from "@earendil-works/pi-durable";
import { encodeJsonl } from "../rpc/framing.js";
import { EventProjector } from "./events.js";

const IMAGE_MIME: Readonly<Record<string, string>> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

export interface OneShotDeps {
	/** Submit one prompt and resolve to whether it was answered. */
	submitAndWait(content: string | readonly unknown[]): Promise<boolean>;
	lastAssistantText(): Promise<string | undefined>;
	watchEvents(): Promise<AgentEventStream>;
	isQuiescent(): Promise<boolean>;
	readonly sessionId: string;
	readonly cwd: string;
	readonly out: Writable;
}

async function write(out: Writable, record: unknown): Promise<void> {
	out.write(encodeJsonl(record));
}

/**
 * Resolve `@path` references (task 1.3) and prepend piped stdin to the first
 * prompt (task 1.2). Text files inline; images become image content blocks.
 */
export async function resolvePrompts(
	prompts: readonly string[],
	stdinText: string | undefined,
): Promise<{ texts: string[]; images: unknown[] }> {
	const texts: string[] = [];
	const images: unknown[] = [];
	for (const prompt of prompts) {
		if (prompt.startsWith("@")) {
			const path = prompt.slice(1);
			const buffer = await readFile(path);
			const mime = IMAGE_MIME[extname(path).toLowerCase()];
			if (mime !== undefined) {
				images.push({ type: "image", mimeType: mime, data: buffer.toString("base64") });
				texts.push("");
				continue;
			}
			texts.push(buffer.toString("utf8"));
			continue;
		}
		texts.push(prompt);
	}
	if (stdinText !== undefined && stdinText.length > 0) {
		texts[0] = texts.length === 0 ? stdinText : `${stdinText}\n${texts[0]}`;
	}
	return { texts, images };
}

/** Run the prompts in order and write pi-shaped output; resolves to the exit code (tasks 2.2-2.4). */
export async function runOneShot(
	mode: "print" | "json",
	prompts: readonly string[],
	deps: OneShotDeps,
	stdinText?: string,
): Promise<number> {
	const { texts, images } = await resolvePrompts(prompts, stdinText);

	let stop: (() => Promise<unknown>) | undefined;
	if (mode === "json") {
		await write(deps.out, {
			type: "session",
			version: 3,
			id: deps.sessionId,
			timestamp: new Date().toISOString(),
			cwd: deps.cwd,
		});
		const stream = await deps.watchEvents();
		const projector = new EventProjector((record) => void write(deps.out, record), () => deps.isQuiescent());
		stream.start(async (events) => projector.handle(events));
		stop = () => stream.stop();
	}

	let answered = true;
	for (const [index, text] of texts.entries()) {
		const content = index === 0 && images.length > 0 ? [{ type: "text", text }, ...images] : text;
		answered = await deps.submitAndWait(content);
	}

	if (stop !== undefined) await stop();
	if (mode === "print") {
		const text = await deps.lastAssistantText();
		if (text !== undefined) deps.out.write(`${text}\n`);
	}
	return answered ? 0 : 1;
}
