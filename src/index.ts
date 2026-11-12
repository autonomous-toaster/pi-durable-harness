/**
 * Harness entry point: resolve the startup contract, load pi's resources,
 * open the durable engine, and serve pi-RPC on stdin/stdout.
 */
import { DefaultResourceLoader, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolveConfig } from "./harness/config.js";
import { HarnessEngine } from "./harness/engine.js";
import { resolveSession } from "./harness/session.js";
import { runOneShot } from "./harness/oneshot.js";
import type { PromptResources } from "./harness/prompt.js";
import {
	applyFlags,
	applyProviders,
	classifyExtension,
	discoverResources,
	extensionCommands,
	reportDiagnostics,
	translateExtension,
	type DiscoveredResources,
} from "./extensions/host.js";
import { ExtensionEventBus } from "./extensions/events.js";
import { createExtensionContext, emptySessionManager } from "./extensions/context.js";
import {
	createSessionManager,
	emptySnapshot,
	installActions,
	installPreludeActions,
	refreshSnapshot,
} from "./extensions/actions.js";
import { RpcServer } from "./rpc/server.js";
import { HarnessSession } from "./rpc/session.js";
import { loadMcpTools } from "./tools/mcp.js";
import type { RegisteredMcpServer } from "./tools/exposure.js";

const USAGE = "durable-rpc — pi-RPC-compatible harness backed by Pi Durable\n";

/** Read all of piped stdin (task 1.2); the caller only does this for a non-terminal stdin. */
async function readStdin(): Promise<string> {
	let text = "";
	for await (const chunk of process.stdin) text += chunk.toString("utf8");
	return text;
}

/** Re-read resources with the paths an extension discovered, without reloading extensions. */
async function reloadResources(
	config: { readonly cwd: string; readonly agentDir: string },
	settingsManager: SettingsManager,
	discovered: DiscoveredResources,
): Promise<DefaultResourceLoader> {
	const loader = new DefaultResourceLoader({
		cwd: config.cwd,
		agentDir: config.agentDir,
		settingsManager,
		noExtensions: true,
		additionalSkillPaths: [...discovered.skillPaths],
		additionalPromptTemplatePaths: [...discovered.promptPaths],
	});
	await loader.reload({ resolveProjectTrust: async () => settingsManager.isProjectTrusted() });
	return loader;
}

export async function main(argv: readonly string[]): Promise<void> {
	const config = resolveConfig(argv, process.env);
	for (const warning of config.warnings) process.stderr.write(`durable-rpc: ${warning}\n`);
	if (config.help) {
		process.stdout.write(USAGE);
		return;
	}
	// A malformed session id cannot be opened, and rewriting it would silently
	// continue the wrong session (task 1.3).
	if (config.sessionError !== undefined) {
		process.stderr.write(`durable-rpc: ${config.sessionError}\n`);
		process.exitCode = 1;
		return;
	}
	// An explicit RPC mode ignores positional arguments instead of refusing them:
	// the config already warned, and pi's own resolver serves RPC either way. A
	// stray token must never keep a client from reaching the server.

	// Resolve the session before storage opens: explicit id, newest for `-c`, or new.
	const resolved = await resolveSession(config);
	if (resolved.warning !== undefined) process.stderr.write(`durable-rpc: ${resolved.warning}\n`);
	const key = resolved.id;
	const modelRuntime = await ModelRuntime.create();
	const settingsManager = SettingsManager.create(config.cwd);
	const loader = new DefaultResourceLoader({
		cwd: config.cwd,
		agentDir: config.agentDir,
		settingsManager,
		noExtensions: false,
	});
	await loader.reload({ resolveProjectTrust: async () => settingsManager.isProjectTrusted() });

	// pi extensions: translate what the loader recorded, report the rest (tasks 3.1-3.11).
	const loaded = loader.getExtensions();
	for (const failure of loaded.errors) process.stderr.write(`durable-rpc: extension ${failure.path} failed: ${failure.error}\n`);
	// The session view exists only once the engine and its snapshot do, so the
	// provider is assigned below and the tool call reads it at call time (task 5.1).
	let sessionView: (() => Promise<Record<string, unknown>>) | undefined;
	const translated = loaded.extensions.map((extension) =>
		translateExtension(extension, () => sessionView?.() ?? Promise.resolve(emptySessionManager())),
	);
	const diagnostics = loaded.extensions.flatMap((extension) => classifyExtension(extension).unsupported);
	reportDiagnostics(diagnostics);
	applyProviders(loaded.runtime.pendingProviderRegistrations, modelRuntime);
	applyFlags(loaded.extensions, argv, loaded.runtime.flagValues);

	// Discovery handlers may read the command set and settings before the engine exists.
	installPreludeActions(loaded.runtime, {
		settings: () => settingsManager.getSettings(),
		commands: () =>
			loaded.extensions.flatMap((extension) =>
				[...extension.commands.values()].map((command) => ({
					name: command.name,
					description: command.description,
					source: "extension",
					sourceInfo: command.sourceInfo,
				})),
			),
	});

	// `resources_discover` lets an extension add skill and template paths. A second
	// loader reads them with `noExtensions`, so no factory runs twice.
	const discovered = await discoverResources(loaded.extensions, config.cwd);
	const resourceLoader =
		discovered.skillPaths.length === 0 && discovered.promptPaths.length === 0
			? loader
			: await reloadResources(config, settingsManager, discovered);
	const resources: PromptResources = {
		cwd: config.cwd,
		agentsFiles: resourceLoader.getAgentsFiles().agentsFiles,
		skills: resourceLoader.getSkills().skills,
		prompts: resourceLoader.getPrompts().prompts,
		// The argv flags layer over the loader's values: `--system-prompt` replaces
		// the preamble, each `--append-system-prompt` appends after the loader's own.
		systemPrompt: config.systemPrompt ?? resourceLoader.getSystemPrompt(),
		appendSystemPrompt: [...resourceLoader.getAppendSystemPrompt(), ...config.appendSystemPrompt],
	};
	// Servers an extension registered join the same connection set as `mcp.json`.
	const registeredMcp: RegisteredMcpServer[] = loaded.runtime.mcpServers.list().map((server) => ({
		name: server.name,
		config: server.config as RegisteredMcpServer["config"],
		source: server.extensionPath,
	}));
	const mcp = await loadMcpTools(config.agentDir, config.cwd, registeredMcp);

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

	// One snapshot and one context shape serve commands, session handlers, tools,
	// and the event bus (tasks 5.1-5.3).
	const snapshot = emptySnapshot();
	const sessionManager = createSessionManager(snapshot, key);
	sessionView = async () => {
		await refreshSnapshot(engine, snapshot);
		return createSessionManager(snapshot, key);
	};
	const extensionContext = (): ReturnType<typeof createExtensionContext> =>
		createExtensionContext({ cwd: config.cwd, sessionManager });

	// Register extension commands and session-lifecycle handlers on the opened engine (tasks 3.9-3.11).
	for (const extension of loaded.extensions) {
		for (const [name, command] of extensionCommands(extension)) {
			engine.registerCommand(
				{ name, description: command.description ?? "", source: "extension", sourceInfo: command.sourceInfo },
				(args) => command.handler(args, extensionContext() as never),
			);
		}
		engine.installSessionHandlers(
			(["session_before_switch", "session_before_fork", "session_before_tree"] as const).flatMap(
				(event) =>
					(extension.handlers.get(event) ?? []).map(
						(handler) => (sessionEvent) => handler(sessionEvent as never, extensionContext() as never),
					),
			),
		);
	}
	// Give the extension action surface (`pi.sendMessage`, `pi.getSessionId`, ...)
	// durable-backed implementations before any handler runs.
	installActions(loaded.runtime, engine);

	const bus = new ExtensionEventBus(
		loaded.extensions,
		extensionContext(),
		(result) =>
			process.stderr.write(
				`durable-rpc: extension ${result.extension} returned ${result.field} on ${result.event}; an RPC host does not apply it\n`,
			),
		() => refreshSnapshot(engine, snapshot),
	);
	const session = new HarnessSession(engine, key, bus);
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
		bus.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" });
		await bus.idle().catch(() => {});
		await engine.close().catch(() => {});
		await mcp.close().catch(() => {});
	}
}
