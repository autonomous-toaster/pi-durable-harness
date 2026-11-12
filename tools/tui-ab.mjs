#!/usr/bin/env node
/**
 * A/B the two TUIs: pi itself and this harness, same cwd, model, and keys.
 *
 * Both processes get the identical input script in their own tmux session, the
 * screen is captured after each step, volatile parts (token counts, timings,
 * session paths) are normalized, and the remaining difference is printed. Any
 * difference is a parity bug to fix or to record.
 *
 *   node tools/tui-ab.mjs                       # boot + prompt + tool + /session
 *   node tools/tui-ab.mjs --provider X --model Y
 *   node tools/tui-ab.mjs --keep                # leave the sessions running
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = (name, fallback) => {
	const index = argv.indexOf(`--${name}`);
	return index === -1 ? fallback : argv[index + 1];
};
const provider = option("provider", "litellm");
const model = option("model", "deepseek-v4-1-flash");
const keep = argv.includes("--keep");
const tmux = (...args) => execFileSync("tmux", args, { encoding: "utf8" });

/** Two screens hold the same lines, in whatever order the panes scrolled. */
const setsEqual = (first, second) =>
	first.length === second.length && first.every((line) => second.includes(line)) && second.every((line) => first.includes(line));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const capture = (session) => tmux("capture-pane", "-p", "-t", session);

/** Steps both TUIs receive, with the wait each needs. */
const steps = [
	// The startup panels are longer than a pane and scroll independently, so boot is
	// reported but not decisive; the chat steps below are what parity is judged on.
	{ name: "boot", keys: [], settle: 14_000, mode: "set", strict: false },
	{ name: "prompt", keys: ["Say exactly: alpha bravo"], settle: 16_000 },
	// The model words a tool answer differently each run, so this step is reported
	// but does not decide parity; the row itself is checked by the live test.
	{ name: "tool", keys: ["Use the bash tool (not codemode) with command: printf parity"], settle: 18_000, strict: false },
	{ name: "session", keys: ["/session"], settle: 6_000 },
];

/** Drop what legitimately differs between two runs; keep the last `tail` lines. */
function normalize(text, tail = 12) {
	return text
		.replaceAll(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
		.replaceAll(/\x1b\][^\x07]*\x07/g, "")
		.replaceAll(/↑[\d.]+k? ↓[\d.]+/g, "↑N ↓N")
		.replaceAll(/\d+(\.\d+)?%\/[\d.]+[kM] \(\w+\)/g, "CTX")
		.replaceAll(/Took \d+\.\d+s/g, "Took T")
		.replaceAll(/\d+\.\d+s/g, "T")
		// Token and cost figures differ between two independent runs of a model.
		.replaceAll(/(Input|Cached|Uncached|Output|Total|Cost|R\w+): [\d,.]+/g, "$1: N")
		.replaceAll(/R\d+(\.\d+)?k?/g, "RN")
		.replaceAll(/\([\d.]+%\)/g, "(N%)")
		.replaceAll(/CH[\d.]+%/g, "CH%")
		// Known gap: the durable host has no cache warmer, so pi's status line differs.
		.replaceAll(/Status: Inactive \((cache lifetime|cache warming) unavailable\)/g, "Status: Inactive (cache unavailable)")
		.replaceAll(/\/[^\s]*sessions\/[^\s]*/g, "<session>")
		.replaceAll(/[ \t]+/g, " ")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.join("\n");
}

const sessions = { pi: "ab-pi", ours: "ab-ours" };
const commands = {
	pi: `pi --provider ${provider} --model ${model}`,
	ours: `node ${join(root, "dist", "cli.js")} --provider ${provider} --model ${model}`,
};

for (const [side, session] of Object.entries(sessions)) {
	try {
		tmux("kill-session", "-t", session);
	} catch {}
	tmux("new-session", "-d", "-s", session, "-x", "170", "-y", "60", "-c", root);
	tmux("send-keys", "-t", session, commands[side], "Enter");
}

const report = [];
for (const step of steps) {
	await sleep(step.settle);
	for (const [side, session] of Object.entries(sessions)) {
		for (const keys of step.keys) tmux("send-keys", "-t", session, keys, "Enter");
	}
	if (step.keys.length > 0) await sleep(step.settle);
	const screens = {};
	for (const [side, session] of Object.entries(sessions)) {
		// The panes scroll independently: the chat is compared by its recent lines, the
		// startup panels as a whole set of lines, so a scroll offset is not a difference.
		const raw = normalize(capture(session), Infinity);
		if (step.mode === "set") {
			screens[side] = raw;
			continue;
		}
		// Anchor on the prompt this step typed, so a scroll offset above it is not a
		// difference; without an anchor, the recent lines are compared.
		const anchor = step.keys.at(-1);
		const lines = raw.split("\n");
		const at = anchor === undefined ? -1 : lines.findLastIndex((line) => line.includes(anchor.slice(0, 24)));
		screens[side] = (at === -1 ? lines.slice(-12) : lines.slice(at)).join("\n");
	}
	const same =
		step.mode === "set"
			? setsEqual(screens.pi.split("\n"), screens.ours.split("\n"))
			: screens.pi === screens.ours;
	report.push({ step: step.name, same, strict: step.strict !== false });
	if (!same) {
		const piLines = screens.pi.split("\n");
		const oursLines = screens.ours.split("\n");
		const width = Math.max(piLines.length, oursLines.length);
		const diff = [];
		for (let line = 0; line < width; line++) {
			if (piLines[line] === oursLines[line]) continue;
			diff.push(`  line ${line + 1}\n    pi:   ${piLines[line] ?? "(absent)"}\n    ours: ${oursLines[line] ?? "(absent)"}`);
		}
		process.stdout.write(`\n=== ${step.name}: DIFFERENT ===\n${diff.slice(0, 12).join("\n")}\n`);
	} else {
		process.stdout.write(`=== ${step.name}: identical ===\n`);
	}
}

if (!keep) for (const session of Object.values(sessions)) try { tmux("kill-session", "-t", session); } catch {}

const differing = report.filter((row) => row.strict && !row.same).map((row) => row.step);
const informal = report.filter((row) => !row.strict && !row.same).map((row) => row.step);
if (informal.length > 0) process.stdout.write(`\nnot compared strictly: ${informal.join(", ")}\n`);
process.stdout.write(differing.length === 0 ? "\nparity: identical at every step\n" : `\nparity: differs at ${differing.join(", ")}\n`);
process.exitCode = differing.length === 0 ? 0 : 1;
