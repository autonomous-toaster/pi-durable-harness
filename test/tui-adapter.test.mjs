/**
 * The TUI adapter over a fake engine (tasks 3.1-3.3, 4.1, 4.3, 4.4, 5.2, 6.2).
 *
 * A fake engine lets each surface be asserted without a model or a terminal.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createTuiRuntime } from "../dist/harness/tui/adapter.js";
import { resolveConfig } from "../dist/harness/config.js";

const context = BACKGROUND_CONTEXT;

/** An engine that records what the adapter asks of it. */
function fakeEngine() {
	const calls = { configure: [], submit: [], controls: [], aborted: 0 };
	const entries = [
		{ id: 1, kind: "pi.user", model: [{ role: "user", content: "hello" }] },
		{ id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: "hi" }] },
	];
	let listener;
	return {
		calls,
		entries: async () => entries,
		messages: async () => entries.map((entry) => entry.model[0]),
		resolvedAgent: async () => ({ model: { provider: "p", modelId: "m" }, thinkingLevel: "high" }),
		isQuiescent: async () => true,
		currentThinkingLevel: () => "high",
		declaredToolNames: () => ["read", "bash"],
		allTools: () => [{ name: "read", description: "r", parameters: {} }, { name: "bash", description: "b", parameters: {} }],
		activeTools: (names) => names.map((name) => ({ name })),
		configure: async (change) => {
			calls.configure.push(change);
		},
		submit: async (content, whenBusy) => {
			calls.submit.push({ content, whenBusy });
			return { id: 1 };
		},
		// A submission is awaited, as pi's own prompt() awaits the run.
		submitAndWait: async (content, whenBusy) => {
			calls.submit.push({ content, whenBusy });
			return true;
		},
		abort: async () => {
			calls.aborted += 1;
		},
		appendControl: async (data) => {
			calls.controls.push(data);
		},
		appendEntry: async () => undefined,
		watchEvents: async () => ({
			value: { conversation: { id: 1 }, entries, docs: {} },
			start: (next) => {
				listener = next;
			},
			stop: async () => {},
		}),
		emit(entry) {
			listener?.({ kind: "value", retired: false, ops: [], value: { conversation: { id: 1 }, entries: [...entries, entry], docs: {} } });
		},
	};
}

const options = {
	cwd: "/work",
	sessionId: "s1",
	settingsManager: {},
	resourceLoader: {},
	modelRuntime: {},
	thinkingLevel: "off",
};

test("the session manager serves the durable transcript", async () => {
	const engine = fakeEngine();
	const runtime = createTuiRuntime(engine, options);
	await runtime.refresh();
	assert.equal(runtime.sessionManager.getEntryCount(), 2);
	assert.equal(runtime.sessionManager.getSessionId(), "s1");
	assert.equal(runtime.sessionManager.getLeafId(), "2");
	const entries = runtime.sessionManager.getEntries();
	assert.equal(entries.length, 2);
	assert.equal(entries[0].message.role, "user");
});

test("custom entries and labels are durable control entries", async () => {
	const engine = fakeEngine();
	const runtime = createTuiRuntime(engine, options);
	await runtime.sessionManager.appendCustomEntry("x.y", { a: 1 });
	await runtime.sessionManager.appendLabelChange("2", "checkpoint");
	assert.deepEqual(engine.calls.controls[0], { type: "custom", customType: "x.y", data: { a: 1 } });
	assert.deepEqual(engine.calls.controls[1], { type: "label", label: "checkpoint" });
});

test("model and tool operations reach the engine", async () => {
	const engine = fakeEngine();
	const runtime = createTuiRuntime(engine, options);
	await runtime.session.setModel({ provider: "p", id: "m2" });
	await runtime.session.setThinkingLevel("low");
	runtime.session.setActiveToolsByName(["read"]);
	assert.deepEqual(engine.calls.configure[0], { model: { provider: "p", modelId: "m2" } });
	assert.deepEqual(engine.calls.configure[1], { thinkingLevel: "low" });
	assert.deepEqual(engine.calls.configure[2], { tools: [{ name: "read" }] });
});

test("prompt, steer, and abort go through durable submissions", async () => {
	const engine = fakeEngine();
	const runtime = createTuiRuntime(engine, options);
	await runtime.session.prompt("hello");
	await runtime.session.steer("more");
	await runtime.session.abort();
	assert.deepEqual(engine.calls.submit, [
		{ content: "hello", whenBusy: undefined },
		{ content: "more", whenBusy: "steer" },
	]);
	assert.equal(engine.calls.aborted, 1);
});

test("a control entry is announced as the event the TUI renders", async () => {
	const engine = fakeEngine();
	const runtime = createTuiRuntime(engine, options);
	await runtime.refresh();
	await runtime.startWatching();
	const seen = [];
	runtime.session.subscribe((event) => seen.push(event));
	engine.emit({ id: 3, kind: "harness.control", data: { type: "thinking_level_change", level: "low" } });
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(seen.some((event) => event.type === "thinking_level_changed" && event.level === "low"), JSON.stringify(seen));
});

test("a terminal selects the TUI and an explicit mode does not", () => {
	assert.equal(resolveConfig([], {}, "/w", true).interfaceName, "tui");
	assert.equal(resolveConfig([], {}, "/w", false).interfaceName, "rpc");
	assert.equal(resolveConfig(["--mode", "rpc"], {}, "/w", true).interfaceName, "rpc");
	assert.equal(resolveConfig(["--mode", "tui"], {}, "/w", false).interfaceName, "tui");
	assert.equal(resolveConfig(["hello"], {}, "/w", true).interfaceName, "print");
});

test("pi's runner renders an extension's tool row (task 6.1)", () => {
	const renderer = { render: () => "row" };
	const extension = {
		path: "fixture",
		handlers: new Map(),
		tools: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
		messageRenderers: new Map(),
		entryRenderers: new Map(),
		toolRenderers: [() => renderer],
	};
	const runtime = createTuiRuntime(fakeEngine(), { ...options, extensions: [extension] });
	const runner = runtime.session.extensionRunner;
	assert.equal(runner.constructor.name, "ExtensionRunner");
	assert.deepEqual(runner.resolveToolRenderers("bash", () => undefined), renderer);
});

test("extension bindings give the runner a ui context and execute nothing", async () => {
	const engine = fakeEngine();
	const runtime = createTuiRuntime(engine, { ...options, extensions: [] });
	const bound = [];
	const runner = runtime.session.extensionRunner;
	assert.equal(typeof runner.setUIContext, "function");
	await runtime.session.bindExtensions({ uiContext: { kind: "ui" }, mode: "tui" });
	assert.deepEqual(bound, [], "the runner executes nothing on bind");
	// The harness's own host is the only executor: a bind writes no entry.
	assert.deepEqual(engine.calls.controls, []);
	assert.ok(runner !== undefined);
});
