/**
 * Harness entry point: resolve the startup contract, load pi's resources,
 * open the durable engine, and serve pi-RPC on stdin/stdout.
 */
import {
	DefaultResourceLoader,
	ModelRegistry,
	ModelRuntime,
	resolveCliModel,
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
	resolveModelScopeWithDiagnostics,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { dirname } from "node:path";
import { resolveConfig, type HarnessConfig } from "./harness/config.js";
import { HarnessEngine, openSessionStorage } from "./harness/engine.js";
import { copySession } from "./harness/fork.js";
import { newSessionId, resolveSession, sessionFile } from "./harness/session.js";
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
import { computeActivation, computeDeclaredTools } from "./tools/activate.js";
import { setMcpEntries } from "./tools/state.js";
import type { RegisteredMcpServer } from "./tools/exposure.js";

const USAGE = `pi-durable — pi-RPC-compatible harness backed by Pi Durable

Usage:
  pi-durable [options] [prompt ...]
  pi-durable --mode rpc              serve pi's RPC protocol on stdin/stdout

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
	trusted: boolean,
): Promise<DefaultResourceLoader> {
	const loader = new DefaultResourceLoader({
		cwd: config.cwd,
		agentDir: config.agentDir,
		settingsManager,
		noExtensions: true,
		additionalSkillPaths: [...config.skillPaths, ...discovered.skillPaths],
		additionalPromptTemplatePaths: [...config.promptTemplatePaths, ...discovered.promptPaths],
	});
	// The answer, not the manager: `reload` flips the manager to untrusted for its
	// bootstrap pass, so asking it back would report the value it just forced.
	await loader.reload({ resolveProjectTrust: async () => trusted });
	return loader;
}

/**
 * Whether a project is trusted, decided the way pi decides it:
 *
 *  - a project with nothing to trust is trusted, whatever the store says;
 *  - otherwise a saved decision, which may be inherited from a parent folder, wins;
 *  - otherwise `defaultProjectTrust` decides: `always`, `never`, or `ask` — and asking
 *    is only possible with a terminal, where the answer is saved like pi saves it.
 *
 * `settingsManager.isProjectTrusted()` is the raw flag and ignores all of that, so it
 * is never the source here.
 */
async function resolveProjectTrust(
	agentDir: string,
	cwd: string,
	settingsManager: SettingsManager,
): Promise<boolean> {
	const store = new ProjectTrustStore(agentDir);
	let saved: boolean | null = null;
	try {
		saved = store.get(cwd);
	} catch {
		saved = null;
	}
	if (!hasTrustRequiringProjectResources(cwd)) return saved ?? true;
	if (saved !== null) return saved;
	switch (settingsManager.getDefaultProjectTrust()) {
		case "always":
			return true;
		case "never":
			return false;
		default:
			break;
	}
	if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) return false;
	const answer = await askProjectTrust(cwd);
	if (answer === undefined) return false;
	store.setMany(answer.updates);
	return answer.trusted;
}

/** pi's three answers, asked on the terminal before the session starts. */
async function askProjectTrust(
	cwd: string,
): Promise<{ readonly trusted: boolean; readonly updates: { readonly path: string; readonly decision: boolean | null }[] } | undefined> {
	const parent = dirname(cwd);
	const options = [
		{ label: "Trust", trusted: true, updates: [{ path: cwd, decision: true as boolean | null }] },
		...(parent === cwd
			? []
			: [
					{
						label: `Trust parent folder (${parent})`,
						trusted: true,
						updates: [
							{ path: parent, decision: true as boolean | null },
							{ path: cwd, decision: null },
						],
					},
				]),
		{ label: "Do not trust", trusted: false, updates: [{ path: cwd, decision: false as boolean | null }] },
	];
	process.stderr.write(`\nProject trust: ${cwd}\n`);
	options.forEach((option, index) => process.stderr.write(`  ${index + 1}. ${option.label}\n`));
	process.stderr.write("Which one? [1] ");
	const { createInterface } = await import("node:readline/promises");
	const readline = createInterface({ input: process.stdin, output: process.stderr });
	try {
		const line = (await readline.question("")).trim();
		const index = line === "" ? 0 : Number(line) - 1;
		return options[index];
	} catch {
		return undefined;
	} finally {
		readline.close();
	}
}

export async function main(argv: readonly string[]): Promise<void> {
	const config = resolveConfig(argv, process.env);
	for (const warning of config.warnings) process.stderr.write(`pi-durable: ${warning}\n`);
	if (config.databaseUrl !== undefined) {
		// Said before connecting, because the pooler's answer is cryptic.
		const { missingTenant } = await import("./storage/postgres/ssl.js");
		const tenant = missingTenant(config.databaseUrl);
		if (tenant !== undefined) process.stderr.write(`pi-durable: ${tenant}\n`);
	}
	if (config.help) {
		process.stdout.write(USAGE);
		return;
	}
	// A malformed session id cannot be opened, and rewriting it would silently
	// continue the wrong session (task 1.3).
	if (config.sessionError !== undefined) {
		process.stderr.write(`pi-durable: ${config.sessionError}\n`);
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
	if (resolved.warning !== undefined) process.stderr.write(`pi-durable: ${resolved.warning}\n`);
	const key = resolved.id;
	const modelRuntime = await ModelRuntime.create();
	// The trust decision the loader and the TUI share. Without it the manager answers
	// with pi's default (trusted) while the loader resolves the store (untrusted), so a
	// TUI neither prompts nor loads what it claims to ignore.
	// pi resolves trust before anything loads: the store, the default, or the answer to
	// a prompt. The answer is what the loader, the manager, MCP and the TUI all use.
	const settingsManager = SettingsManager.create(config.cwd, config.agentDir);
	const trusted = await resolveProjectTrust(config.agentDir, config.cwd, settingsManager);
	settingsManager.setProjectTrusted(trusted);

	// `--models` and `--model` resolve through pi's own resolver, so fuzzy
	// matching, `:thinking` suffixes, and provider ambiguity behave as in pi.
	const scope =
		config.modelPatterns.length === 0
			? undefined
			: await resolveModelScopeWithDiagnostics([...config.modelPatterns], modelRuntime);
	for (const diagnostic of scope?.diagnostics ?? []) {
		process.stderr.write(`pi-durable: ${diagnostic.message}\n`);
	}
	const cliModel = resolveCliModel({
		...(config.provider === undefined ? {} : { cliProvider: config.provider }),
		...(config.model === undefined ? {} : { cliModel: config.model }),
		...(config.thinking === undefined ? {} : { cliThinking: config.thinking as never }),
		inlineApiKey: config.apiKey !== undefined,
		modelRuntime,
	});
	if (cliModel.error !== undefined) {
		process.stderr.write(`pi-durable: ${cliModel.error}\n`);
		process.exitCode = 1;
		return;
	}
	if (cliModel.warning !== undefined) process.stderr.write(`pi-durable: ${cliModel.warning}\n`);
	if (config.forkFrom !== undefined) {
		// pi: the fork lands in this directory as a new session named by --session-id.
		const source = await openSessionStorage(config, config.forkFrom);
		const target = await openSessionStorage(config, key);
		try {
			const copied = await copySession(source.storage, target.storage, modelRuntime);
			process.stderr.write(`pi-durable: forked ${copied.entries} entries from ${config.forkFrom}\n`);
		} catch (error) {
			process.stderr.write(`pi-durable: fork failed: ${error instanceof Error ? error.message : String(error)}\n`);
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
			process.stderr.write("pi-durable: --api-key requires --model or --models\n");
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
	await loader.reload({ resolveProjectTrust: async () => trusted });

	// pi extensions: translate what the loader recorded, report the rest (tasks 3.1-3.11).
	const loaded = loader.getExtensions();
	for (const failure of loaded.errors) process.stderr.write(`pi-durable: extension ${failure.path} failed: ${failure.error}\n`);
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
			: await reloadResources(config, settingsManager, discovered, trusted);
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
	// pi reads a project's mcp.json only for a trusted project.
	const mcp = await loadMcpTools(config.agentDir, config.cwd, registeredMcp, {
		projectTrusted: trusted,
	});

	const defaultTools = (settingsManager.getSettings().defaultTools ?? []) as readonly string[];
	const codemodeMode = (): "on" | "only" =>
		((settingsManager.getSettings() as { codemode?: { mode?: string } }).codemode?.mode ?? "on") as "on" | "only";
	let currentMcp = mcp;
	let extraExtensions = currentMcp.tools.length === 0 ? [...translated] : [{ name: "harness.mcp", tools: currentMcp.tools }, ...translated];
	/**
	 * `/reload` re-reads the MCP configuration: a server added or removed takes effect
	 * then, without a new session. The prompt's `mcp_servers` section and the declared
	 * tool set both follow.
	 */
	const reloadMcp = async (): Promise<void> => {
		await currentMcp.close().catch(() => {});
		currentMcp = await loadMcpTools(config.agentDir, config.cwd, registeredMcp, { projectTrusted: trusted });
		setMcpEntries(currentMcp.entries);
		const activation = computeActivation(currentMcp.settings.servers, currentMcp.settings.autoEnableCodemode ?? true, defaultTools, codemodeMode());
		const declared = computeDeclaredTools(engine.toolRegistrations(), activation, defaultTools, codemodeMode());
		await engine.applyMcp(currentMcp.settings.servers, currentMcp.tools, declared);
	};
	// A session another process holds cannot be written; say so and stop rather than
	// hang on a pool that outlived the failure.
	let opened: HarnessEngine;
	try {
		opened = await HarnessEngine.open({
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
	} catch (error) {
		if ((error as { name?: string } | undefined)?.name === "SessionLockedError") {
			const held = error instanceof Error ? error.message : "this session";
			process.stderr.write(
				[
					`pi-durable: ${held}; this process cannot write to it.`,
					"  Continue in a new session:      node dist/cli.js",
					"  Continue in a fork of it:       node dist/cli.js --fork <session-id>",
					"  Or name another session:        node dist/cli.js --session-id <id>",
					"",
				].join("\n"),
			);
			// Nothing else was opened, but the MCP servers are: leaving them running is
			// what makes the process hang after saying the session is taken.
			await mcp.close().catch(() => {});
			process.exitCode = 2;
			return;
		}
		throw error;
	}
	const engine = opened;

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
				`pi-durable: extension ${result.extension} returned ${result.field} on ${result.event}; an RPC host does not apply it\n`,
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
				...(config.databaseUrl === undefined
					? { sessionFile: sessionFile(config, key) }
					: { sessionFile: `postgres:${config.schema}/${config.tenant}__${key}` }),
				settingsManager,
				resourceLoader: tuiResourceLoader,
				modelRuntime,
				modelRegistry: new ModelRegistry(modelRuntime),
				thinkingLevel: config.thinking ?? "off",
				resolveProjectTrust: () => trusted,
				reloadMcp,
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
