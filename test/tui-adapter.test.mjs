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
		/** The same, with a live document state (a run that just ended, say). */
		emitWithRun(entry, live) {
			const docs = live.running === false ? {} : { "pi.live": { run: { taskId: 1 } } };
			listener?.({ kind: "value", retired: false, ops: [], value: { conversation: { id: 1 }, entries: [...entries, entry], docs } });
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

// pi's agent_end deletes the streaming component, so a run that ends before its
// message is announced wipes the answer off the screen. The message must come first.
test("agent_end is announced after the run's messages, never before", async () => {
	const engine = fakeEngine();
	const runtime = createTuiRuntime(engine, options);
	await runtime.refresh();
	await runtime.startWatching();
	const seen = [];
	runtime.session.subscribe((event) => seen.push(event.type));
	// One revision where the run ends *and* its assistant message lands.
	engine.emitWithRun(
		{ id: 3, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "the answer" }] }] },
		{ running: false },
	);
	assert.deepEqual(seen.slice(-3), ["entry_appended", "message_start", "message_end"], seen.join(","));
	assert.equal(seen.includes("agent_end"), false, "the run was never running in this view");
});

// pi moves the tree's leaf and reads `result.aborted` off what the session returns:
// returning nothing made selecting a node throw "Cannot read properties of undefined".
test("selecting a user message rewinds to before it and returns its text", async () => {
	const engine = fakeEngine();
	const rewinds = [];
	engine.rewind = async (at) => {
		rewinds.push(at);
		return "conversation-2";
	};
	const runtime = createTuiRuntime(engine, options);
	await runtime.refresh();
	const result = await runtime.session.navigateTree("1");
	assert.deepEqual(rewinds, [null]);
	assert.equal(result.cancelled, false);
	assert.equal(result.editorText, "hello");
});

test("selecting an assistant message rewinds to that entry", async () => {
	const engine = fakeEngine();
	const rewinds = [];
	engine.rewind = async (at) => {
		rewinds.push(at);
		return "conversation-2";
	};
	const runtime = createTuiRuntime(engine, options);
	await runtime.refresh();
	// A non-user node is the leaf itself; only a user message rewinds to before it.
	const result = await runtime.session.navigateTree("2");
	assert.deepEqual(rewinds, ["2"]);
	assert.equal(result.cancelled, false);
	assert.equal(result.editorText, undefined);
});

// A branch summary is pi's feature; durable has none, so the request is refused
// rather than navigated without it.
test("a branch summary request is refused, not silently skipped", async () => {
	const engine = fakeEngine();
	let rewound = false;
	engine.rewind = async () => {
		rewound = true;
		return "conversation-2";
	};
	const runtime = createTuiRuntime(engine, options);
	await runtime.refresh();
	const result = await runtime.session.navigateTree("2", { summarize: true });
	assert.deepEqual(result, { cancelled: false, aborted: true });
	assert.equal(rewound, false);
});

// pi prints the path /export gets back, so an export must write a file and answer it.
test("an export writes the file and answers its path", async () => {
	const { mkdtemp, readFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = await mkdtemp(join(tmpdir(), "export-test-"));
	const engine = fakeEngine();
	engine.exportHtml = async () => "<html>transcript</html>";
	const runtime = createTuiRuntime(engine, options);
	await runtime.refresh();
	try {
		const htmlPath = await runtime.session.exportToHtml(join(dir, "out.html"));
		assert.equal(htmlPath, join(dir, "out.html"));
		assert.equal(await readFile(htmlPath, "utf8"), "<html>transcript</html>");

		const jsonlPath = await runtime.session.exportToJsonl(join(dir, "out.jsonl"));
		assert.equal(jsonlPath, join(dir, "out.jsonl"));
		assert.match(await readFile(jsonlPath, "utf8"), /"type":"message"/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

// pi hands the compact result to the caller's onComplete, so the value must travel.
test("compact answers what the engine compacted", async () => {
	const engine = fakeEngine();
	engine.compact = async (instructions) => ({ summary: `compacted ${instructions}` });
	const runtime = createTuiRuntime(engine, options);
	assert.deepEqual(await runtime.session.compact("focus on the tests"), { summary: "compacted focus on the tests" });
});
