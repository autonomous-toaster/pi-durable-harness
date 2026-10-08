/**
 * pi's process entry markers. Under `pi --mode rpc` the entry point sets a
 * process title and two markers before running; child processes inherit them
 * and use them to identify the launching agent (parity: T1.6).
 */
export const AGENT_MARKER = "pi";
export const HARNESS_PROCESS_TITLE = "pi-rpc";

export function applyProcessMarkers(): void {
	process.title = HARNESS_PROCESS_TITLE;
	process.env.PI_CODING_AGENT = "true";
	process.env.AI_AGENT = AGENT_MARKER;
}
