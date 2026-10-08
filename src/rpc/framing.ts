/**
 * Strict JSONL framing for the RPC protocol (task 3.1).
 *
 * Records split on LF only. A reader that also treats U+2028/U+2029 as
 * boundaries (for example Node's `readline`) would split inside JSON strings,
 * so this reader must not use one. A trailing carriage return is stripped so
 * CRLF input is accepted. Stdout carries protocol records only; diagnostics go
 * to stderr elsewhere.
 */
import { once } from "node:events";
import type { Writable } from "node:stream";

export async function* readJsonl(source: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of source) {
		buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
		let boundary = buffer.indexOf("\n");
		while (boundary !== -1) {
			let line = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (line.length > 0) yield line;
			boundary = buffer.indexOf("\n");
		}
	}
}

/** One compact JSON object terminated by a single LF. */
export function encodeJsonl(record: unknown): string {
	return `${JSON.stringify(record)}\n`;
}

/** Write one record and wait for the stream to accept more data. */
export async function writeJsonl(stream: Writable, record: unknown): Promise<void> {
	if (!stream.write(encodeJsonl(record))) await once(stream, "drain");
}
