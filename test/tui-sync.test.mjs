import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// pi's interface is a synchronous client: it calls some session members without awaiting and
// renders the value (a thinking level, an export path). A Promise there prints "[object Promise]"
// and a rejected one kills the process, so the members it calls synchronously must answer
// synchronously. The set comes from pi's own dist, not from a list.
test("every member pi calls without awaiting answers synchronously", () => {
	const output = execFileSync(process.execPath, [join(root, "tools", "tui-sync.mjs"), "--check"], {
		cwd: root,
		encoding: "utf8",
	});
	const offenders = output.split("\n").filter((line) => line.startsWith("THENABLE") || line.startsWith("MISSING"));
	assert.deepEqual(offenders, [], offenders.join("\n"));
	assert.match(output, /^\d+\/\d+ synchronous members answer synchronously/m);
});

test("the thinking level and the export path are answered, not promised", async () => {
	const { createTuiRuntime } = await import("../dist/harness/tui/adapter.js");
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const calls = [];
	// The engine remembers the level synchronously; the test stub does the same.
	let remembered = "off";
	const engine = new Proxy(
		{
			entries: async () => [],
			messages: async () => [],
			readChanges: async () => ({ entries: [], full: true }),
			documents: async () => ({}),
			status: async () => ({ entryCount: 0, messageCount: 0, policy: {} }),
			isQuiescent: async () => true,
			resolvedAgent: async () => ({ cwd: process.cwd() }),
			currentThinkingLevel: () => remembered,
			rememberThinkingLevel: (level) => {
				remembered = level;
				calls.push(level);
			},
			getAvailableThinkingLevels: () => ["off", "low", "high"],
			configure: async (change) => calls.push(change.thinkingLevel),
			appendControl: async () => {},
			knownEntries: [],
			messagesKnown: [],
			view: async () => ({ entries: [], docs: {} }),
			watchEvents: async () => ({ value: undefined, start: () => {}, stop: async () => {} }),
		},
		{ get: (target, key) => (key in target ? target[key] : () => undefined) },
	);
	const runtime = createTuiRuntime(engine, {
		cwd: process.cwd(),
		sessionId: "sync",
		settingsManager: { get: () => undefined, getEnabledModels: () => [] },
		resourceLoader: { getSkills: () => ({ skills: [] }), getPrompts: () => ({ prompts: [] }) },
		modelRuntime: { getModel: () => undefined },
		thinkingLevel: "off",
		extensions: [],
	});
	await runtime.refresh();

	// Ctrl+T: pi interpolates this value into "Thinking level: <value>".
	const level = runtime.session.cycleThinkingLevel();
	assert.equal(typeof level, "string", "the cycle answers a level, not a promise");
	assert.equal(level, "low");
	assert.equal(runtime.session.thinkingLevel, "low", "the interface reports the new level immediately");

	// /export x.jsonl: pi prints the path this returns.
	const path = runtime.session.exportToJsonl(join(mkdtempSync(join(tmpdir(), "pi-export-")), "s.jsonl"));
	assert.equal(typeof path, "string");
	assert.ok(path.endsWith("s.jsonl"));
	const { existsSync } = await import("node:fs");
	assert.ok(existsSync(path), "the file exists when the path is answered");
});
