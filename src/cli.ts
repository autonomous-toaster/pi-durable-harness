#!/usr/bin/env node
import { applyProcessMarkers } from "./process-markers.js";

// Set the markers before the entry module loads; static ESM imports would be
// hoisted above this call, so the entry is imported dynamically.
applyProcessMarkers();

// No top-level await: a Node SEA binary runs this as CommonJS, and the markers
// must be set before the entry module loads, which is why it stays dynamic.
void (async () => {
	const { main } = await import("./index.js");
	await main(process.argv.slice(2));
})().catch((error: unknown) => {
	process.stderr.write(`pi-durable-harness: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
