/**
 * Run pi's TUI over the durable engine (task 2.2).
 *
 * Imported dynamically, so `pi-tui` and its native module never load for RPC,
 * print, json, or SEA runs.
 */
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import type { HarnessEngine } from "../engine.js";
import { createTuiRuntime, type TuiAdapterOptions } from "./adapter.js";

export interface RunTuiOptions extends TuiAdapterOptions {
	readonly verbose?: boolean;
}

/** Hand pi's `InteractiveMode` a durable-backed runtime and run it. */
export async function runTui(engine: HarnessEngine, options: RunTuiOptions): Promise<void> {
	const runtime = createTuiRuntime(engine, options);
	// Prime the snapshot and the watcher before the TUI reads anything.
	await runtime.refresh();
	await runtime.startWatching();
	const mode = new InteractiveMode(
		runtime as never,
		{ verbose: options.verbose ?? false, ...(options.terminal === undefined ? {} : { terminal: options.terminal }) } as never,
	);
	await mode.run();
}
