/**
 * Harness entry point: resolve the startup contract, load pi's resources,
 * open the durable engine, and serve pi-RPC on stdin/stdout.
 */
import { basename } from "node:path";
import { DefaultResourceLoader, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolveConfig } from "./harness/config.js";
import { HarnessEngine } from "./harness/engine.js";
import type { PromptResources } from "./harness/prompt.js";
import { RpcServer } from "./rpc/server.js";
import { HarnessSession } from "./rpc/session.js";
import { loadMcpTools } from "./tools/mcp.js";

const USAGE = "durable-rpc — pi-RPC-compatible harness backed by Pi Durable\n";

export async function main(argv: readonly string[]): Promise<void> {
	const config = resolveConfig(argv, process.env);
	for (const warning of config.warnings) process.stderr.write(`durable-rpc: ${warning}\n`);
	if (config.help) {
		process.stdout.write(USAGE);
		return;
	}

	const key = config.sessionKey ?? config.name ?? basename(config.cwd);
	const modelRuntime = await ModelRuntime.create();
	const settingsManager = SettingsManager.create(config.cwd);
	const loader = new DefaultResourceLoader({
		cwd: config.cwd,
		agentDir: config.agentDir,
		settingsManager,
		noExtensions: true,
	});
	await loader.reload();
	const resources: PromptResources = {
		agentsFiles: loader.getAgentsFiles().agentsFiles,
		skills: loader.getSkills().skills,
		systemPrompt: loader.getSystemPrompt(),
		appendSystemPrompt: loader.getAppendSystemPrompt(),
	};

	const mcp = await loadMcpTools(config.agentDir, config.cwd);
	const extraExtensions = mcp.tools.length === 0 ? [] : [{ name: "harness.mcp", tools: mcp.tools }];
	const engine = await HarnessEngine.open({ config, key, modelRuntime, settingsManager, resources, extraExtensions });
	const session = new HarnessSession(engine, key);
	const server = new RpcServer(session, process.stdin, process.stdout);
	try {
		await server.run();
	} finally {
		await engine.close().catch(() => {});
		await mcp.close().catch(() => {});
	}
}
