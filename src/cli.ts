#!/usr/bin/env node
import { applyProcessMarkers } from "./process-markers.js";

// Set the markers before the entry module loads; static ESM imports would be
// hoisted above this call, so the entry is imported dynamically.
applyProcessMarkers();

const { main } = await import("./index.js");

await main(process.argv.slice(2));
