/**
 * Environment for a test that spawns the CLI.
 *
 * A CLI test asserts the launch contract, not the machine's configuration: an agent directory with
 * configured MCP servers spends up to ten seconds per server failing to connect, and a theme or model
 * it holds changes what the run prints. Each spawn therefore gets an empty, temporary agent directory.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function cliEnv(overrides = {}) {
	return {
		...process.env,
		PI_OFFLINE: "1",
		PI_CODING_AGENT_DIR: mkdtempSync(join(tmpdir(), "pi-cli-")),
		...overrides,
	};
}
