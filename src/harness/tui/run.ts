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
	/** `--use-theme`: the theme the first frame draws with, as pi's own startup passes it. */
	readonly initialThemeSetting?: string;
}

/**
 * The options pi's interface starts with. Only what an invocation set is passed, because
 * pi's own startup leaves an absent value to the stored settings.
 */
export function interactiveModeOptions(options: RunTuiOptions): Record<string, unknown> {
	return {
		verbose: options.verbose ?? false,
		...(options.terminal === undefined ? {} : { terminal: options.terminal }),
		...(options.initialThemeSetting === undefined ? {} : { initialThemeSetting: options.initialThemeSetting }),
	};
}

/** Hand pi's `InteractiveMode` a durable-backed runtime and run it. */
export async function runTui(engine: HarnessEngine, options: RunTuiOptions): Promise<void> {
	const runtime = createTuiRuntime(engine, options);
	// Prime the snapshot and the watcher before the TUI reads anything.
	await runtime.refresh();
	await runtime.startWatching();
	const mode = new InteractiveMode(runtime as never, interactiveModeOptions(options) as never);
	await mode.run();
}
