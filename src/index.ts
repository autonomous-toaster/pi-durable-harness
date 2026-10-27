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
import {
	applyProviders,
	classifyExtension,
	extensionCommands,
	reportDiagnostics,
	translateExtension,
} from "./extensions/host.js";
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
		noExtensions: false,
	});
	await loader.reload({ resolveProjectTrust: async () => settingsManager.isProjectTrusted() });
	const resources: PromptResources = {
		cwd: config.cwd,
		agentsFiles: loader.getAgentsFiles().agentsFiles,
		skills: loader.getSkills().skills,
		prompts: loader.getPrompts().prompts,
		systemPrompt: loader.getSystemPrompt(),
		appendSystemPrompt: loader.getAppendSystemPrompt(),
	};

	const mcp = await loadMcpTools(config.agentDir, config.cwd);

	// pi extensions: translate what the loader recorded, report the rest (tasks 3.1-3.11).
	const loaded = loader.getExtensions();
	for (const failure of loaded.errors) process.stderr.write(`durable-rpc: extension ${failure.path} failed: ${failure.error}\n`);
	const translated = loaded.extensions.map(translateExtension);
	const diagnostics = loaded.extensions.flatMap((extension) => classifyExtension(extension).unsupported);
	reportDiagnostics(diagnostics);
	applyProviders(loaded.runtime.pendingProviderRegistrations, modelRuntime);

	const extraExtensions = mcp.tools.length === 0 ? [...translated] : [{ name: "harness.mcp", tools: mcp.tools }, ...translated];
	const engine = await HarnessEngine.open({
		config,
		key,
		modelRuntime,
		settingsManager,
		resources,
		extraExtensions,
		mcp: { entries: mcp.entries, settings: mcp.settings },
	});

	// Register extension commands and session-lifecycle handlers on the opened engine (tasks 3.9-3.11).
	for (const extension of loaded.extensions) {
		for (const [name, command] of extensionCommands(extension)) {
			engine.registerCommand(
				{ name, description: command.description ?? "", source: "extension", sourceInfo: command.sourceInfo },
				(args) => command.handler(args, {} as never),
			);
		}
		engine.installSessionHandlers(
			(["session_before_switch", "session_before_fork", "session_before_tree"] as const).flatMap(
				(event) =>
					(extension.handlers.get(event) ?? []).map(
						(handler) => (sessionEvent) => handler(sessionEvent as never, {} as never),
					),
			),
		);
	}
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
