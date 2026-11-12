#!/usr/bin/env node
/**
 * The surface pi's TUI expects, read from pi's own code and from the adapter.
 *
 * pi's InteractiveMode reaches into its session, session manager, runtime host,
 * and services. Every member it names is a contract the adapter must meet, so
 * they are extracted from pi's dist and diffed against what the adapter builds.
 * Run without arguments to print the report; `--check` exits non-zero on a gap.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessEngine } from "../dist/harness/engine.js";
import { createTuiRuntime } from "../dist/harness/tui/adapter.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const piDist = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive");

// What pi's TUI reads off the runtime host it is given, plus its services.
const RECEIVERS = {
	session: "session",
	sessionManager: "sessionManager",
	"runtimeHost.services": "services",
	runtimeHost: "runtimeHost",
};

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : path.endsWith(".js") ? [path] : [];
	});
}

/** Every `this.<receiver>.<member>` pi's TUI names, with the first file that names it. */
function required() {
	const seen = new Map();
	for (const file of files(piDist)) {
		const text = readFileSync(file, "utf8");
		for (const [receiver] of Object.entries(RECEIVERS)) {
			for (const match of text.matchAll(new RegExp(`this\\.${receiver.replaceAll(".", "\\.")}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g"))) {
				const key = `${receiver}.${match[1]}`;
				if (!seen.has(key)) seen.set(key, file.slice(piDist.length + 1));
			}
		}
	}
	return seen;
}

/** Build the adapter over a stub engine and enumerate what it actually provides. */
async function provided() {
	const engine = new Proxy(
		{
			entries: async () => [],
			messages: async () => [],
			isQuiescent: async () => true,
			resolvedAgent: async () => ({ cwd: process.cwd() }),
			currentThinkingLevel: () => "off",
			view: async () => ({ entries: [], docs: {} }),
			watchEvents: async () => ({ value: undefined, start: () => {}, stop: async () => {} }),
		},
		{ get: (target, key) => (key in target ? target[key] : () => undefined) },
	);
	const runtime = createTuiRuntime(engine, {
		cwd: process.cwd(),
		sessionId: "surface",
		settingsManager: { get: () => undefined },
		resourceLoader: { getSkills: () => ({ skills: [] }), getPrompts: () => ({ prompts: [] }) },
		modelRuntime: {},
		thinkingLevel: "off",
		extensions: [],
	});
	// The synchronous getters answer from the snapshot, so it is read once first.
	await runtime.refresh();
	const session = runtime.session;
	const have = {
		queue: session.clearQueue?.(),
		tree: runtime.sessionManager.getTree?.(),
		steering: session.getSteeringMessages?.(),
		followup: session.getFollowUpMessages?.(),
		stats: session.getSessionStats?.(),
		forking: session.getUserMessagesForForking?.(),
		entries: runtime.sessionManager.getEntries?.(),
		branch: runtime.sessionManager.getBranch?.(),
	};
	const keys = (object) => new Set(Object.keys(object));
	return {
		shapes: have,
		session: keys(runtime.session),
		sessionManager: keys(runtime.sessionManager),
		services: keys(runtime.services),
		runtimeHost: keys(runtime),
	};
}

const needed = required();
const have = await provided();
const report = [];
for (const [key, where] of [...needed].sort()) {
	const [receiver, member] = key.split(".");
	const present = have[receiver]?.has(member) === true;
	report.push({ key, where, present });
}

const missing = report.filter((row) => !row.present);

/**
 * Members pi destructures, spreads, or indexes. A stub that returns undefined passes
 * the presence check and then crashes the first time that command runs, so the shape
 * is checked too.
 */
const shapes = [
	["session.clearQueue()", () => have.shapes.queue, (value) => typeof value === "object" && Array.isArray(value?.steering) && Array.isArray(value?.followUp)],
	["sessionManager.getTree()", () => have.shapes.tree, (value) => Array.isArray(value)],
	["session.getSteeringMessages()", () => have.shapes.steering, (value) => Array.isArray(value)],
	["session.getFollowUpMessages()", () => have.shapes.followup, (value) => Array.isArray(value)],
	["session.getSessionStats()", () => have.shapes.stats, (value) => typeof value === "object" && typeof value?.tokens === "object"],
	["session.getUserMessagesForForking()", () => have.shapes.forking, (value) => Array.isArray(value)],
	["sessionManager.getEntries()", () => have.shapes.entries, (value) => Array.isArray(value)],
	["sessionManager.getBranch()", () => have.shapes.branch, (value) => Array.isArray(value)],
];
const width = Math.max(...report.map((row) => row.key.length));
for (const row of report) {
	process.stdout.write(`${row.present ? "ok  " : "MISS"} ${row.key.padEnd(width)}  ${row.where}\n`);
}
process.stdout.write(`\n${report.length - missing.length}/${report.length} members provided`);
process.stdout.write(missing.length === 0 ? "\n" : `\n${missing.length} missing: ${missing.map((row) => row.key).join(", ")}\n`);
const badShapes = shapes.filter(([name, read, check]) => {
	const value = read();
	return !check(value);
});
for (const [name] of badShapes) process.stdout.write(`SHAPE ${name} returns the wrong shape\n`);
if (badShapes.length > 0) process.stdout.write(`\n${badShapes.length} members return a shape pi cannot use\n`);

if (process.argv.includes("--check") && (missing.length > 0 || badShapes.length > 0)) process.exitCode = 1;
