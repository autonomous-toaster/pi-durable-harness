/**
 * Harness entry point: resolve the startup contract, load pi's resources,
 * open the durable engine, and serve pi-RPC on stdin/stdout.
 */
import {
	DefaultResourceLoader,
	ModelRegistry,
	ModelRuntime,
	resolveCliModel,
	ProjectTrustStore,
	resolveModelScopeWithDiagnostics,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { resolveConfig, type HarnessConfig } from "./harness/config.js";
import { HarnessEngine, openSessionStorage } from "./harness/engine.js";
import { copySession } from "./harness/fork.js";
import { newSessionId, resolveSession } from "./harness/session.js";
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

const USAGE = `pi-durable-harness — pi-RPC-compatible harness backed by Pi Durable

Usage:
  pi-durable-harness [options] [prompt ...]
  pi-durable-harness --mode rpc              serve pi's RPC protocol on stdin/stdout

Modes:
  --mode rpc            serve RPC; the default when no prompt is given
  --mode text           run the prompts once and print the final answer
  --mode json           run the prompts once and stream JSONL records
  -p, --print           print the final answer (shorthand for --mode text)

Session:
  --session-id <id>     open this session in this directory, or create it
  --session <id>        the same as --session-id
  -c, --continue        open the newest session for this directory
  -n, --name <name>     display name; not part of the identity
  --tenant <name>       tenant label (default: default)
  --session-dir <dir>   where SQLite sessions live
  --fork <id>           copy a session into a new one in this directory
  --no-session          keep the session in memory and store nothing

Model:
  --provider <name>     provider for the first request
  --model <pattern>     model id or pattern
  --models <patterns>   comma-separated scope for startup and cycling
  --api-key <key>       non-persistent key for the selected provider
  --thinking <level>    off, minimal, low, medium, high, xhigh, max

Prompt:
  --system-prompt <text|path>          replace the built-in preamble
  --append-system-prompt <text|path>   append to it; repeatable
  --skill <path>                       load a skill file or directory; repeatable
  --prompt-template <path>             load a template file or directory; repeatable
  @path                                include a text file or an image
  --                                   end options; everything after is a prompt

Other:
  -h, --help            this text
  --offline             no network activity

Accepted for pi compatibility and not acted on:
  --export, --theme

Environment:
  PI_DURABLE_DATABASE_URL        PostgreSQL URL; unset stores in SQLite
  PI_DURABLE_PG_SCHEMA           schema for PostgreSQL sessions (default: durable)
  PI_DURABLE_PG_SSL              disable, require, verify-ca, or verify-full
  PI_DURABLE_PG_SSL_CA           CA certificate in PEM, needed by verify-ca and verify-full
  PI_DURABLE_PG_SSL_CERT         client certificate in PEM, with PI_DURABLE_PG_SSL_KEY
  PI_DURABLE_PG_SSL_KEY          client private key in PEM
  PI_DURABLE_PG_SSL_SERVERNAME   name the server certificate must carry
  PI_DURABLE_PG_REQUIRE_SSL=1    refuse a connection that is not encrypted
  PI_DURABLE_PERSIST_WITHIN_MS   deferred progress window; 0 stores each partial
  PI_CODING_AGENT_DIR            config directory (default: ~/.pi/agent)
  PI_CODING_AGENT_SESSION_DIR    overrides the SQLite session directory
  PI_OFFLINE                     no network activity (same as --offline)
`;

/** Read all of piped stdin (task 1.2); the caller only does this for a non-terminal stdin. */
async function readStdin(): Promise<string> {
	let text = "";
	for await (const chunk of process.stdin) text += chunk.toString("utf8");
	return text;
}

/** Re-read resources with the paths an extension discovered, without reloading extensions. */
async function reloadResources(
	config: HarnessConfig,
	settingsManager: SettingsManager,
	discovered: DiscoveredResources,
): Promise<DefaultResourceLoader> {
	const loader = new DefaultResourceLoader({
		cwd: config.cwd,
		agentDir: config.agentDir,
		settingsManager,
		noExtensions: true,
		additionalSkillPaths: [...config.skillPaths, ...discovered.skillPaths],
		additionalPromptTemplatePaths: [...config.promptTemplatePaths, ...discovered.promptPaths],
	});
	await loader.reload({ resolveProjectTrust: async () => projectTrusted(config.agentDir, config.cwd) });
	return loader;
}

/**
 * Whether a project is trusted, as pi decides it: through the trust store, which
 * inherits a decision from a parent folder. `settingsManager.isProjectTrusted()`
 * alone is the raw flag and would ignore an inherited decision, so an untrusted
 * report would hide project prompts and skills pi loads.
 */
function projectTrusted(agentDir: string, cwd: string): boolean {
	try {
		return new ProjectTrustStore(agentDir).get(cwd) === true;
	} catch {
		return false;
	}
}

export async function main(argv: readonly string[]): Promise<void> {
	const config = resolveConfig(argv, process.env);
	for (const warning of config.warnings) process.stderr.write(`pi-durable-harness: ${warning}\n`);
	if (config.databaseUrl !== undefined) {
		// Said before connecting, because the pooler's answer is cryptic.
		const { missingTenant } = await import("./storage/postgres/ssl.js");
		const tenant = missingTenant(config.databaseUrl);
		if (tenant !== undefined) process.stderr.write(`pi-durable-harness: ${tenant}\n`);
	}
	if (config.help) {
		process.stdout.write(USAGE);
		return;
	}
	// A malformed session id cannot be opened, and rewriting it would silently
	// continue the wrong session (task 1.3).
	if (config.sessionError !== undefined) {
		process.stderr.write(`pi-durable-harness: ${config.sessionError}\n`);
		process.exitCode = 1;
		return;
	}
	// An explicit RPC mode ignores positional arguments instead of refusing them:
	// the config already warned, and pi's own resolver serves RPC either way. A
	// stray token must never keep a client from reaching the server.

	// `--fork` picks a fresh session and copies a source into it; anything else
	// resolves the session the ordinary way before storage opens.
	const resolved =
		config.forkFrom === undefined
			? await resolveSession(config)
			: { id: config.sessionKey ?? newSessionId() };
	if (resolved.warning !== undefined) process.stderr.write(`pi-durable-harness: ${resolved.warning}\n`);
	const key = resolved.id;
	const modelRuntime = await ModelRuntime.create();
	const settingsManager = SettingsManager.create(config.cwd);

	// `--models` and `--model` resolve through pi's own resolver, so fuzzy
	// matching, `:thinking` suffixes, and provider ambiguity behave as in pi.
	const scope =
		config.modelPatterns.length === 0
			? undefined
			: await resolveModelScopeWithDiagnostics([...config.modelPatterns], modelRuntime);
	for (const diagnostic of scope?.diagnostics ?? []) {
		process.stderr.write(`pi-durable-harness: ${diagnostic.message}\n`);
	}
	const cliModel = resolveCliModel({
		...(config.provider === undefined ? {} : { cliProvider: config.provider }),
		...(config.model === undefined ? {} : { cliModel: config.model }),
		...(config.thinking === undefined ? {} : { cliThinking: config.thinking as never }),
		inlineApiKey: config.apiKey !== undefined,
		modelRuntime,
	});
	if (cliModel.error !== undefined) {
		process.stderr.write(`pi-durable-harness: ${cliModel.error}\n`);
		process.exitCode = 1;
		return;
	}
	if (cliModel.warning !== undefined) process.stderr.write(`pi-durable-harness: ${cliModel.warning}\n`);
	if (config.forkFrom !== undefined) {
		// pi: the fork lands in this directory as a new session named by --session-id.
		const source = await openSessionStorage(config, config.forkFrom);
		const target = await openSessionStorage(config, key);
		try {
			const copied = await copySession(source.storage, target.storage, modelRuntime);
			process.stderr.write(`pi-durable-harness: forked ${copied.entries} entries from ${config.forkFrom}\n`);
		} catch (error) {
			process.stderr.write(`pi-durable-harness: fork failed: ${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
			return;
		} finally {
			await source.close().catch(() => {});
			await target.close().catch(() => {});
		}
	}
	if (config.apiKey !== undefined) {
		// pi: the key applies to the provider of the model named by --model/--models.
		const provider = cliModel.model?.provider ?? scope?.scopedModels[0]?.model.provider;
		if (provider === undefined) {
			process.stderr.write("pi-durable-harness: --api-key requires --model or --models\n");
			process.exitCode = 1;
			return;
		}
		await modelRuntime.setRuntimeApiKey(provider, config.apiKey);
	}
	const loader = new DefaultResourceLoader({
		cwd: config.cwd,
		agentDir: config.agentDir,
		settingsManager,
		noExtensions: false,
		additionalSkillPaths: [...config.skillPaths],
		additionalPromptTemplatePaths: [...config.promptTemplatePaths],
	});
	await loader.reload({ resolveProjectTrust: async () => projectTrusted(config.agentDir, config.cwd) });

	// pi extensions: translate what the loader recorded, report the rest (tasks 3.1-3.11).
	const loaded = loader.getExtensions();
	for (const failure of loaded.errors) process.stderr.write(`pi-durable-harness: extension ${failure.path} failed: ${failure.error}\n`);
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
	/**
	 * The TUI shows the loaded extensions in its startup panels, but the loader it is
	 * given has them switched off when an extension contributed resource paths. This
	 * forwards everything and answers `getExtensions` from the loader that did load
	 * them, so the panel lists what ran.
	 */
	const tuiResourceLoader =
		resourceLoader === loader
			? loader
			: new Proxy(resourceLoader, {
					get(target, key, receiver) {
						if (key === "getExtensions") return () => loaded;
						const value = Reflect.get(target, key, receiver) as unknown;
						return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
					},
				});
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
		...(cliModel.model === undefined ? {} : { resolvedModel: cliModel.model }),
		...(cliModel.thinkingLevel === undefined ? {} : { resolvedThinking: cliModel.thinkingLevel }),
		...(scope === undefined ? {} : { modelScope: scope.scopedModels }),
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
				`pi-durable-harness: extension ${result.extension} returned ${result.field} on ${result.event}; an RPC host does not apply it\n`,
			),
		() => refreshSnapshot(engine, snapshot),
	);
	const session = new HarnessSession(engine, key, bus);
	try {
		if (config.interfaceName === "tui") {
			// Loaded here, so pi-tui and its native module never reach the other modes.
			const { runTui } = await import("./harness/tui/run.js");
			await runTui(engine, {
				cwd: config.cwd,
				agentDir: config.agentDir,
				sessionId: key,
				settingsManager,
				resourceLoader: tuiResourceLoader,
				modelRuntime,
				modelRegistry: new ModelRegistry(modelRuntime),
				thinkingLevel: config.thinking ?? "off",
				persisted: !config.ephemeral,
				defaultSessionDir: config.defaultSessionDir,
				extensions: loaded.extensions,
				verbose: config.mode === "tui" ? true : false,
			});
		} else if (config.interfaceName !== "rpc") {
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
