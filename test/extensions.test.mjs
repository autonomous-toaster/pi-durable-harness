import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DefaultResourceLoader, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { HarnessSession } from "../dist/rpc/session.js";
import {
	applyProviders,
	classifyExtension,
	extensionCommands,
	formatDiagnostic,
	reportDiagnostics,
	translateExtension,
} from "../dist/extensions/host.js";

/** Write one extension file into a temporary agent directory and load it. */
async function loadExtension(source) {
	const agentDir = await mkdtemp(join(tmpdir(), "ext-"));
	await mkdir(join(agentDir, "extensions"), { recursive: true });
	await writeFile(join(agentDir, "extensions", "fixture.ts"), source);
	const cwd = await mkdtemp(join(tmpdir(), "cwd-"));
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
	await loader.reload({ resolveProjectTrust: async () => true });
	return loader.getExtensions();
}

const HOSTED_EXTENSION = `
export default function (pi) {
	pi.registerTool({
		name: "fixture_tool",
		label: "Fixture",
		description: "A fixture tool",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
	});
	pi.on("tool_call", async () => ({ block: "blocked by fixture" }));
	pi.on("context", async (event) => ({ messages: [...event.messages, { marked: true }] }));
}
`;

const COMMAND_EXTENSION = `
export default function (pi) {
	pi.registerCommand("fixture-cmd", {
		description: "A fixture command",
		handler: async (args) => { globalThis.__fixtureArgs = args; },
	});
	pi.on("session_before_fork", async () => ({ cancel: true }));
	pi.on("model_select", async () => {});
}
`;

test("a loaded extension factory runs once at startup (task 3.1)", async () => {
	const loaded = await loadExtension(HOSTED_EXTENSION);
	assert.equal(loaded.extensions.length, 1);
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions[0].tools.size, 1);
});

test("registerTool becomes a durable tool (task 3.2)", async () => {
	const loaded = await loadExtension(HOSTED_EXTENSION);
	const durable = translateExtension(loaded.extensions[0]);
	const names = (durable.tools ?? []).map((tool) => tool.name);
	assert.deepEqual(names, ["fixture_tool"]);
	// The translated tool runs the extension's execute.
	const result = await durable.tools[0].execute({}, { env: { cwd: "/tmp" } }, {});
	assert.equal(result.output[0].text, "ok");
});

test("context edits the message list that reaches the model (task 3.3)", async () => {
	const loaded = await loadExtension(HOSTED_EXTENSION);
	const durable = translateExtension(loaded.extensions[0]);
	assert.equal(durable.sections?.length ?? 0, 0, "context edits messages, not the prompt");
	const hook = (durable.hooks ?? []).find((entry) => entry.task === "pi.generation");
	assert.ok(hook !== undefined, "context maps to the generation task");
	const messages = [{ role: "user", content: [] }];
	const result = await hook.handlers.beforeRequest({ messages }, {}, {});
	assert.equal(result.messages.length, 2, "the handler's message list is used");
	assert.deepEqual(result.messages[1], { marked: true });
});

test("tool_call becomes a beforeTool hook that can block (task 3.4)", async () => {
	const loaded = await loadExtension(HOSTED_EXTENSION);
	const durable = translateExtension(loaded.extensions[0]);
	const hook = (durable.hooks ?? []).find((entry) => entry.task === "pi.tool");
	assert.ok(hook !== undefined, "tool_call maps to the tool task");
	const result = await hook.handlers.beforeTool({ name: "read", arguments: {} }, {}, {});
	assert.deepEqual(result, { block: "blocked by fixture" });
});

test("a UI surface is classified unsupported and a command is hosted (task 3.5)", async () => {
	const loaded = await loadExtension(COMMAND_EXTENSION);
	const classification = classifyExtension(loaded.extensions[0]);
	assert.ok(classification.hosted.includes("registerCommand"));
	assert.ok(classification.hosted.includes("session_before_fork"));
	assert.ok(
		classification.unsupported.some((entry) => entry.surface === "model_select"),
		"an unhosted event is reported",
	);
});

test("an unsupported surface is reported on stderr and the run continues (task 3.6)", async () => {
	const loaded = await loadExtension(COMMAND_EXTENSION);
	const diagnostics = classifyExtension(loaded.extensions[0]).unsupported;
	const lines = [];
	reportDiagnostics(diagnostics, (text) => lines.push(text));
	assert.equal(lines.length, diagnostics.length);
	for (const line of lines) assert.match(line, /^durable-rpc: extension .* unhosted surface: /);
	assert.match(lines[0], /model_select/);
	assert.equal(formatDiagnostic({ extension: "p", surface: "s" }), "durable-rpc: extension p uses an unhosted surface: s");
});

test("a translated extension installs into the engine registry with its tool and hooks (task 3.7)", async () => {
	const loaded = await loadExtension(HOSTED_EXTENSION);
	const durable = translateExtension(loaded.extensions[0]);
	assert.equal(durable.tools?.length, 1);
	assert.ok((durable.hooks ?? []).length >= 2);
	assert.match(durable.name, /pi-extension:/);

	// A real durable registry accepts the translated extension.
	const { createRegistry } = await import("@earendil-works/pi-durable");
	const registry = createRegistry();
	registry.install(durable);
	assert.deepEqual(
		registry.snapshot().tools().map((entry) => entry.tool.name),
		["fixture_tool"],
	);
	assert.equal(
		registry
			.snapshot()
			.installed()
			.some((entry) => entry.name === durable.name),
		true,
	);
});

test("a provider registration is forwarded to the model runtime (task 3.8)", async () => {
	const registered = [];
	applyProviders([{ name: "fixture-provider", config: { name: "Fixture" } }], {
		registerProvider: (name, config) => registered.push({ name, config }),
	});
	assert.equal(registered.length, 1);
	assert.equal(registered[0].name, "fixture-provider");

	// The real runtime accepts the same call shape and lists the provider's models.
	const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
	modelRuntime.registerProvider("fixture-provider", {
		name: "Fixture",
		models: [{ id: "fixture-1", name: "Fixture 1", api: "openai-completions", baseUrl: "http://localhost:1/v1" }],
	});
	assert.ok(modelRuntime.getModels("fixture-provider").some((model) => model.id === "fixture-1"));
});

test("an extension command is listed and resolved to handled (tasks 3.9, 3.10)", async () => {
	const loaded = await loadExtension(COMMAND_EXTENSION);
	const commands = extensionCommands(loaded.extensions[0]);
	assert.ok(commands.has("fixture-cmd"));

	// Drive the harness path: listing plus prompt resolution.
	const listed = [];
	let submitted = 0;
	const engine = {
		commands: () => listed.map((name) => ({ name, description: "", source: "extension", sourceInfo: {} })),
		registerCommand: (info, handler) => {
			listed.push(info.name);
			engine.handlers.set(info.name, handler);
		},
		handlers: new Map(),
		runCommand: async (message) => {
			if (!message.startsWith("/")) return false;
			const [name, ...rest] = message.slice(1).split(" ");
			const handler = engine.handlers.get(name);
			if (handler === undefined) return false;
			await handler(rest.join(" ").trim());
			return true;
		},
		skills: [],
		submit: async () => {
			submitted += 1;
			return { status: async () => ({ status: "done" }) };
		},
	};
	const session = new HarnessSession(engine, "s");
	for (const [name, command] of commands) {
		engine.registerCommand(
			{ name, description: command.description ?? "", source: "extension", sourceInfo: command.sourceInfo },
			(args) => command.handler(args, {}),
		);
	}
	const result = await session.submit("/fixture-cmd hello", undefined, undefined);
	assert.equal(result.disposition, "handled");
	assert.equal(submitted, 0, "no model run starts for a resolved command");
	assert.equal(globalThis.__fixtureArgs, "hello", "the handler received its arguments");
	assert.deepEqual((await session.getCommands()).commands.map((command) => command.name), ["fixture-cmd"]);
});

test("a session veto cancels the change before state is captured (task 3.11)", async () => {
	const loaded = await loadExtension(COMMAND_EXTENSION);
	const handlers = loaded.extensions[0].handlers.get("session_before_fork");
	assert.ok(handlers !== undefined);
	assert.deepEqual(await handlers[0]({ type: "session_before_fork", entryId: "1", position: "at" }, {}), {
		cancel: true,
	});

	// Drive the harness path: a veto must leave the session untouched.
	let forked = 0;
	const engine = {
		sessionVeto: async () => true,
		fork: async () => {
			forked += 1;
			return { conversationId: "x" };
		},
		entries: async () => [{ id: "e1" }],
	};
	const session = new HarnessSession(engine, "s");
	const result = await session.fork("e1");
	assert.equal(result.canceled, true);
	assert.equal(forked, 0, "a veto leaves the session unchanged");
	assert.equal((await session.clone()).canceled, true);
	assert.equal(forked, 0);
});

test("session_before_compact declines the summary through the compaction hook (task 3.11)", async () => {
	const loaded = await loadExtension(`
export default function (pi) {
	pi.on("session_before_compact", async () => ({ cancel: true }));
}
`);
	const durable = translateExtension(loaded.extensions[0]);
	const hook = (durable.hooks ?? []).find((entry) => entry.task === "pi.compaction");
	assert.ok(hook !== undefined, "session_before_compact maps to the compaction task");
	assert.deepEqual(await hook.handlers.beforeCompact({ reason: "manual" }, {}, {}), { decline: true });
});
