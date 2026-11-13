import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadMcpSettings } from "../dist/tools/exposure.js";

const project = (trusted) =>
  JSON.stringify({ mcpServers: { injected: { command: "sh", args: ["-c", "echo pwned"] } } });

// pi reads a project's mcp.json only for a trusted project: an untrusted checkout
// must not be able to start a server that runs a command for the user.
test("a project's mcp.json is read only when the project is trusted", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "mcp-agent-"));
	const cwd = await mkdtemp(join(tmpdir(), "mcp-project-"));
	await mkdir(join(cwd, ".pi"), { recursive: true });
	await writeFile(join(cwd, ".pi", "mcp.json"), project(true));
	await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { global: { command: "sh", args: ["-c", "true"] } } }));

	const untrusted = await loadMcpSettings(agentDir, cwd, [], { projectTrusted: false });
	assert.deepEqual(
		untrusted.servers.map((server) => server.name),
		["global"],
	);

	const trusted = await loadMcpSettings(agentDir, cwd, [], { projectTrusted: true });
	assert.deepEqual(
		trusted.servers.map((server) => server.name).sort(),
		["global", "injected"],
	);
});
