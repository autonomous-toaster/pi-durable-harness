/**
 * Harness entry point: resolve the startup contract, load pi's resources,
 * open the durable engine, and serve pi-RPC on stdin/stdout.
 */
import { basename } from "node:path";
import { DefaultResourceLoader, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolveConfig } from "./harness/config.js";
import { HarnessEngine } from "./harness/engine.js";
import { runOneShot } from "./harness/oneshot.js";
import type { PromptResources } from "./harness/prompt.js";
import { RpcServer } from "./rpc/server.js";
import { HarnessSession } from "./rpc/session.js";
import { loadMcpTools } from "./tools/mcp.js";

const USAGE = "durable-rpc — pi-RPC-compatible harness backed by Pi Durable\n";

/** Read all of piped stdin (task 1.2); the caller only does this for a non-terminal stdin. */
async function readStdin(): Promise<string> {
	let text = "";
	for await (const chunk of process.stdin) text += chunk.toString("utf8");
	return text;
}

export async function main(argv: readonly string[]): Promise<void> {
	const config = resolveConfig(argv, process.env);
	for (const warning of config.warnings) process.stderr.write(`durable-rpc: ${warning}\n`);
	if (config.help) {
		process.stdout.write(USAGE);
		return;
	}
	// A positional prompt and RPC mode together are refused (task 2.5).
	if (config.prompts.length > 0 && config.mode === "rpc") {
		process.stderr.write("durable-rpc: RPC mode takes prompts through the prompt command, not as arguments\n");
		process.exitCode = 1;
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
	await loader.reload({ resolveProjectTrust: async () => settingsManager.isProjectTrusted() });
	const resources: PromptResources = {
		cwd: config.cwd,
		agentsFiles: loader.getAgentsFiles().agentsFiles,
		skills: loader.getSkills().skills,
		systemPrompt: loader.getSystemPrompt(),
		appendSystemPrompt: loader.getAppendSystemPrompt(),
	};

	const mcp = await loadMcpTools(config.agentDir, config.cwd);
	const extraExtensions = mcp.tools.length === 0 ? [] : [{ name: "harness.mcp", tools: mcp.tools }];
	const engine = await HarnessEngine.open({
		config,
		key,
		modelRuntime,
		settingsManager,
		resources,
		extraExtensions,
		mcp: { entries: mcp.entries, settings: mcp.settings },
	});
	const session = new HarnessSession(engine, key);
	try {
		if (config.interfaceName !== "rpc") {
			const stdinText = process.stdin.isTTY === true ? undefined : await readStdin();
			process.exitCode = await runOneShot(
				config.interfaceName,
				config.prompts,
				{
					submitAndWait: (content) => engine.submitAndWait(content),
					lastAssistantText: () => engine.lastAssistantText(),
					watchEvents: () => engine.watchEvents(),
					isQuiescent: () => engine.isQuiescent(),
					sessionId: key,
					cwd: config.cwd,
					out: process.stdout,
				},
				stdinText,
			);
		} else {
			const server = new RpcServer(session, process.stdin, process.stdout);
			await server.run();
		}
	} finally {
		await engine.close().catch(() => {});
		await mcp.close().catch(() => {});
	}
}
