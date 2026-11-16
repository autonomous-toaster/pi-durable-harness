#!/usr/bin/env node
/**
 * The synchronous half of pi's session contract.
 *
 * pi's `InteractiveMode` is a synchronous client: it calls some session members without
 * `await` and uses the return value directly — interpolated into a status line, assigned to
 * a variable that is printed, destructured. When our adapter answers such a member with a
 * Promise, the interface renders `[object Promise]`, and a rejected background write turns
 * into an unhandled rejection, which Node treats as fatal.
 *
 * The set of "called without await" members is derived from pi's own dist, not from a list,
 * so a new pi release that starts using a member synchronously is caught here.
 *
 *   node tools/tui-sync.mjs           # report
 *   node tools/tui-sync.mjs --check   # exit 1 when a member answers with a thenable
 */
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const interactive = join(root, "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js");

/** Every `this.session.<name>(` call site pi does not await. */
function synchronousMembers() {
	const source = readFileSync(interactive, "utf8");
	const found = new Map();
	const pattern = /this\.session\.([A-Za-z_$][\w$]*)\s*\(/g;
	let match;
	while ((match = pattern.exec(source)) !== null) {
		const name = match[1];
		const lineStart = source.lastIndexOf("\n", match.index) + 1;
		const lineEnd = source.indexOf("\n", match.index);
		const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
		const awaited = /\bawait\b/.test(line) || /\.then\s*\(/.test(line) || /\.catch\s*\(/.test(line);
		// A forwarder hands the member to someone else (`waitForIdle: () => this.session.waitForIdle()`),
		// and the caller of that forwarder decides whether to await: not a synchronous use here.
		const forwarder = /[\w$]+\s*:\s*(?:async\s*)?\([^)]*\)\s*=>\s*this\.session\./.test(line);
		if (!awaited && !forwarder && !found.has(name)) found.set(name, line.trim().slice(0, 100));
	}
	return found;
}

/** A runtime over a stub engine, the way `tui-surface.mjs` builds one. */
async function runtime() {
	const { createTuiRuntime } = await import("../dist/harness/tui/adapter.js");
	const engine = new Proxy(
		{
			entries: async () => [],
			messages: async () => [],
			readChanges: async () => ({ entries: [], full: true }),
			documents: async () => ({}),
			status: async () => ({ entryCount: 0, messageCount: 0, policy: {} }),
			isQuiescent: async () => true,
			resolvedAgent: async () => ({ cwd: process.cwd() }),
			currentThinkingLevel: () => "off",
			rememberThinkingLevel: () => {},
			getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
			configure: async () => {},
			appendControl: async () => {},
			knownEntries: [],
			messagesKnown: [],
			lastAnswerKnown: undefined,
			agentKnown: undefined,
			cacheWarmingStatus: undefined,
			view: async () => ({ entries: [], docs: {} }),
			watchEvents: async () => ({ value: undefined, start: () => {}, stop: async () => {} }),
		},
		{ get: (target, key) => (key in target ? target[key] : () => undefined) },
	);
	return createTuiRuntime(engine, {
		cwd: process.cwd(),
		sessionId: "sync",
		settingsManager: { get: () => undefined, getEnabledModels: () => [] },
		resourceLoader: { getSkills: () => ({ skills: [] }), getPrompts: () => ({ prompts: [] }) },
		modelRuntime: { getModel: () => undefined },
		thinkingLevel: "off",
		extensions: [],
	});
}

/** Arguments a call needs to be exercisable without touching the user's files. */
function argumentsFor(name, scratch) {
	if (name === "setThinkingLevel") return ["low"];
	if (name === "setSessionName") return ["sync-probe"];
	if (name === "setSteeringMode" || name === "setFollowUpMode") return ["all"];
	if (name === "setCacheWarmingMode") return ["off"];
	if (name === "setAutoCompactionEnabled") return [true];
	if (name === "exportToJsonl") return [join(scratch, "sync.jsonl")];
	if (name === "recordBashResult") return ["true", { output: "ok" }, { excludeFromContext: true }];
	if (name === "getUserMessagesForForking") return [];
	if (name === "setScopedModels") return [[]];
	return [];
}

const members = synchronousMembers();
const host = await runtime();
const session = host.session;
const scratch = mkdtempSync(join(tmpdir(), "pi-sync-"));
const findings = [];

for (const [name, callLine] of [...members].sort(([a], [b]) => a.localeCompare(b))) {
	const member = session[name];
	if (typeof member !== "function") {
		findings.push({ name, kind: "MISSING", detail: callLine });
		continue;
	}
	let value;
	try {
		value = member.apply(session, argumentsFor(name, scratch));
	} catch (error) {
		// A member that throws synchronously is still synchronous: that is acceptable.
		continue;
	}
	if (value !== null && typeof value === "object" && typeof value.then === "function") {
		findings.push({ name, kind: "THENABLE", detail: callLine });
	}
}

const check = process.argv.includes("--check");
const missing = findings.filter((finding) => finding.kind === "MISSING");
const thenable = findings.filter((finding) => finding.kind === "THENABLE");

for (const finding of findings) {
	process.stdout.write(`${finding.kind.padEnd(8)} ${finding.name.padEnd(26)} pi: ${finding.detail}\n`);
}
process.stdout.write(
	`${members.size - findings.length}/${members.size} synchronous members answer synchronously` +
		`${missing.length === 0 ? "" : `, ${missing.length} missing`}${thenable.length === 0 ? "" : `, ${thenable.length} thenable`}\n`,
);

if (check && findings.length > 0) {
	process.stdout.write(
		thenable.length > 0
			? "pi renders these values directly: answer synchronously and run the write in the background.\n"
			: "pi calls these members: the adapter must provide them.\n",
	);
	process.exitCode = 1;
}
