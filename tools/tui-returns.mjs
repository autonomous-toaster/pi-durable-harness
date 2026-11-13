#!/usr/bin/env node
/**
 * What the adapter returns, against what pi's TUI reads off it.
 *
 * `navigateTree` returned `undefined`, and pi read `result.aborted` off it: a member
 * can exist, answer without throwing, and still be the wrong shape. This calls every
 * member the adapter exposes, records what comes back, and looks for the places pi
 * consumes a return value (assignment, destructuring, chained property access).
 *
 *   node tools/tui-returns.mjs            report
 *   node tools/tui-returns.mjs --check    exit 1 when a consumed value is undefined
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTuiRuntime } from "../dist/harness/tui/adapter.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const piDist = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive");

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : path.endsWith(".js") ? [path] : [];
	});
}

/** Every place pi consumes the value of `this.<receiver>.<member>(`. */
function consumedMembers() {
	const consumed = new Set();
	const destructured = new Set();
	for (const file of files(piDist)) {
		const text = readFileSync(file, "utf8");
		for (const [receiver] of [["session"], ["sessionManager"], ["services"], ["runtimeHost"]]) {
			for (const match of text.matchAll(new RegExp(`this\\.${receiver}\\.(\\w+)\\(`, "g"))) {
				const name = match[1];
				const before = text.slice(Math.max(0, match.index - 60), match.index);
				const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40);
				// `= await this.session.x(`, `= this.session.x(`, `(await this.session.x(...)).y`
				if (/=\s*(await\s+)?$/.test(before) || /^\)?\.\w/.test(after) || /^\[/.test(after)) consumed.add(name);
				if (/const\s*\{[^}]*\}\s*=\s*(await\s+)?$/.test(before)) destructured.add(name);
			}
		}
	}
	return { consumed, destructured };
}

/** A stub engine: every call resolves, so the adapter can be exercised. */
const engine = new Proxy(
	{
		entries: async () => [],
		messages: async () => [],
		isQuiescent: async () => true,
		resolvedAgent: async () => ({ cwd: process.cwd() }),
		currentThinkingLevel: () => "off",
		// A stub that answers a plausible value, so a check sees the adapter's shape
		// rather than the stub's emptiness.
		compact: async () => ({ summary: "stub" }),
		exportHtml: async () => "<html></html>",
		lastAssistantText: async () => "stub",
		allTools: () => [],
		declaredToolNames: () => [],
		fork: async () => ({ id: "2" }),
		newConversation: async () => ({ id: "2" }),
		rewind: async () => "2",
		getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
		configure: async () => undefined,
		newSession: async () => ({ cancelled: false }),
		view: async () => ({ entries: [], docs: {} }),
		watchEvents: async () => ({ value: undefined, start: () => {}, stop: async () => {} }),
	},
	// Unknown members answer with a resolved promise, since the adapter awaits them.
	{ get: (target, key) => (key in target ? target[key] : async () => undefined) },
);

const buildRuntime = async () =>
	createTuiRuntime(engine, {
		cwd: process.cwd(),
		sessionId: "returns",
		settingsManager: { get: () => undefined },
		resourceLoader: { getSkills: () => ({ skills: [] }), getPrompts: () => ({ prompts: [] }) },
		modelRuntime: {},
		thinkingLevel: "off",
		extensions: [],
	});
const first = await buildRuntime();
await first.refresh();

const { consumed, destructured } = consumedMembers();
const args = {
	navigateTree: ["1"],
	prompt: ["hi"],
	steer: ["hi"],
	followUp: ["hi"],
	switchTo: ["x"],
	setModel: [{ provider: "p", id: "m" }],
	setThinkingLevel: ["high"],
	setActiveTools: [[]],
	compact: [],
	reload: [],
	exportToHtml: [],
	exportToJsonl: [],
	getSessionFile: [],
	getSessionName: [],
	clearQueue: [],
	waitForIdle: [],
	applyResources: [],
	rewind: [null],
	fork: ["1"],
	switchSession: ["/tmp/session"],
	getToolDefinition: ["bash"],
	setActiveToolsByName: [[]],
	executeBash: ["true"],
	getUserMessagesForForking: [],
};
const rows = [];
const receivers = { session: first.session, sessionManager: first.sessionManager, services: first.services, runtimeHost: first };
for (const receiver of Object.keys(receivers)) {
	const object = (receiver === "runtimeHost" ? first : receivers[receiver]) ?? {};
	for (const name of Object.keys(object)) {
		const value = object[name];
		if (typeof value !== "function") continue;
		let returned;
		try {
			// A fresh runtime per member: a member that leaves state behind would
			// otherwise make the next one look broken.
			const fresh = await buildRuntime();
			await fresh.refresh();
			const instance = receiver === "runtimeHost" ? fresh : fresh[receiver];
			returned = await instance[name].apply(instance, args[name] ?? []);
		} catch (error) {
			rows.push({ receiver, name, value: `throws ${error?.constructor?.name}`, consumed: consumed.has(name) });
			continue;
		}
		const kind =
			returned === undefined
				? "undefined"
				: returned === null
					? "null"
					: Array.isArray(returned)
						? "array"
						: typeof returned;
		rows.push({ receiver, name, value: kind, consumed: consumed.has(name) });
	}
}

const width = Math.max(...rows.map((row) => `${row.receiver}.${row.name}`.length));
for (const row of rows.sort((a, b) => Number(b.consumed) - Number(a.consumed) || a.name.localeCompare(b.name))) {
	const flag = row.consumed && (row.value === "undefined" || row.value === "null") ? "SUSPECT" : row.consumed ? "consumed" : "        ";
	process.stdout.write(`${flag} ${`${row.receiver}.${row.name}`.padEnd(width)} -> ${row.value}${row.consumed && destructured.has(row.name) ? "  (destructured)" : ""}\n`);
}
/**
 * Members whose empty answer pi handles: each was read at its call site and the reader
 * tests it rather than a field of it. A new suspect that is not listed here fails.
 */
const EXPECTED_EMPTY = new Map([
	["getContextUsage", "pi treats an unknown context as undefined and hides the figure"],
	["getLastAssistantText", "pi answers 'no messages to copy yet' on a falsy text"],
	["getLeafId", "null is pi's own 'no leaf' answer"],
	["getSessionName", "an unnamed session prints no name"],
	["setScopedModels", "a setter; pi reads nothing back"],
	["refresh", "own member, not pi's"],
	["startWatching", "own member, not pi's"],
	["setRebindSession", "own member, not pi's"],
	["setBeforeSessionInvalidate", "own member, not pi's"],
]);

const suspects = rows.filter(
	(row) => row.consumed && (row.value === "undefined" || row.value === "null") && !EXPECTED_EMPTY.has(row.name),
);
const explained = rows.filter(
	(row) => row.consumed && (row.value === "undefined" || row.value === "null") && EXPECTED_EMPTY.has(row.name),
);
process.stdout.write(`\n${rows.length} members called, ${rows.filter((r) => r.consumed).length} consumed by pi, ${suspects.length} suspect\n`);
if (process.argv.includes("--check") && suspects.length > 0) process.exitCode = 1;
