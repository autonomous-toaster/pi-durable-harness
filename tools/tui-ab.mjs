#!/usr/bin/env node
/**
 * The TUI feature matrix: pi and this harness, side by side.
 *
 * Every feature pi's TUI offers is a scenario here. Each runs in a fresh pair of
 * tmux sessions over the same agent directory, so a step cannot see another's
 * history, and the two screens are compared after the volatile parts (token
 * counts, timings, paths, scroll) are normalized. A scenario fails when the
 * screens differ or when either process reports an uncaught exception.
 *
 *   node tools/tui-ab.mjs                 # the fast scenarios
 *   node tools/tui-ab.mjs --all           # every scenario, including slow ones
 *   node tools/tui-ab.mjs --only tool-bash,thinking
 *   node tools/tui-ab.mjs --list
 *   node tools/tui-ab.mjs --keep          # leave the last pair running
 *
 * The agent directory defaults to ~/.pi-durable/agent, so the runs never touch
 * the real configuration: PI_DURABLE_AGENT_DIR overrides it.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
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
const agentDir = option("agent-dir", process.env.PI_DURABLE_AGENT_DIR ?? join(homedir(), ".pi-durable", "agent"));
const keep = argv.includes("--keep");
const all = argv.includes("--all");
const only = option("only", undefined)?.split(",").map((name) => name.trim());
const tmux = (...args) => execFileSync("tmux", args, { encoding: "utf8" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A scenario: what is typed, how long it needs, and how its screen is compared. */
const scenarios = [
	{ name: "boot", steps: [], wait: 14_000, mode: "set" },
	// The model's prose is not comparable; what a prompt must produce is the footer
	// chrome and an answer, without either process crashing.
	{ name: "prompt", steps: [{ send: "Say exactly: alpha bravo" }], wait: 16_000, mode: "chrome" },
	{ name: "tool-bash", steps: [{ send: "Use the bash tool (not codemode) with command: printf matrix" }], wait: 18_000, mode: "rows" },
	{ name: "tool-read", steps: [{ send: "Read the first 3 lines of package.json with the read tool" }], wait: 18_000, mode: "rows" },
	{ name: "tool-write", steps: [{ send: "Use the write tool to create /tmp/pi-ab-write.txt with the text hello" }], wait: 18_000, mode: "rows" },
	{ name: "codemode-nested", steps: [{ send: 'Use codemode with exactly this code, no changes: const r = await tools.bash({ command: "python3 --version" }); return { out: r.output, code: r.exit_code };' }], wait: 22_000, mode: "rows" },
	{ name: "codemode-list-tools", steps: [{ send: 'Use codemode with exactly this code, no changes: return ALL_TOOLS.map((t) => t.name).join(", ");' }], wait: 20_000, mode: "rows" },
	{ name: "thinking", steps: [{ send: "/thinking high" }, { key: "Enter", wait: 3000 }, { send: "Say exactly: thinking works" }], wait: 18_000, mode: "chrome" },
	{ name: "session-command", mode: "set", steps: [{ send: "/session" }], wait: 6000 },
	{ name: "model-command", mode: "set", steps: [{ send: "/model" }], wait: 6000 },
	{ name: "settings-command", mode: "set", steps: [{ send: "/settings" }], wait: 6000 },
	{ name: "help-command", mode: "chrome", steps: [{ send: "/help" }], wait: 14_000 },
	{ name: "name-command", mode: "set", steps: [{ send: "/name ab-test" }], wait: 5000 },
	{ name: "autocomplete-command", mode: "set", steps: [{ type: "/" }], wait: 5000 },
	{ name: "autocomplete-file", mode: "set", steps: [{ type: "@package" }], wait: 5000 },
	{ name: "bash-mode", steps: [{ send: "!echo matrix-bash" }, { key: "Enter" }], wait: 8000 },
	{ name: "template-command", mode: "set", steps: [{ send: "/deepsearch what is MCP" }], wait: 3000 },
	{ name: "tree-selector", mode: "set", steps: [{ send: "Say exactly: tree" }, { key: "Enter" }, { key: "Escape", wait: 800 }, { key: "Escape" }], wait: 20_000 },
	{ name: "ctrl-o-expand", steps: [{ send: "Use the bash tool (not codemode) with command: printf expanded" }, { key: "Enter", wait: 16_000 }, { key: "C-o" }], wait: 20_000, mode: "rows", slow: true },
	{ name: "interrupt-escape", steps: [{ send: "Count slowly from 1 to 40" }, { key: "Enter", wait: 4000 }, { key: "Escape" }], wait: 12_000, slow: true },
	{ name: "history-ctrl-r", steps: [{ send: "Say exactly: history" }, { key: "Enter", wait: 14_000 }, { key: "C-r" }], wait: 18_000, slow: true },
];

/** Drop what legitimately differs between two runs. */
function normalize(text, tail = 12) {
	const lines = text
		.replaceAll(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
		.replaceAll(/\x1b\][^\x07]*\x07/g, "")
		.replaceAll(/↑[\d.]+k? ↓[\d.]+/g, "↑N ↓N")
		.replaceAll(/\d+(\.\d+)?%\/[\d.]+[kM] \(\w+\)/g, "CTX")
		.replaceAll(/Took \d+\.\d+s/g, "Took T")
		.replaceAll(/\d+\.\d+s/g, "T")
		.replaceAll(/\d+ms/g, "Nms")
		.replaceAll(/R\d+(\.\d+)?k?/g, "RN")
		.replaceAll(/CH[\d.]+%/g, "CH%")
		.replaceAll(/(Input|Cached|Uncached|Output|Total|Cost): [\d,.]+/g, "$1: N")
		.replaceAll(/\/[^\s]*sessions\/[^\s]*/g, "<session>")
		.replaceAll(/(?<=\S)[ \t]+/g, " ")
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line !== "");
	return tail === Infinity ? lines : lines.slice(-tail);
}

/** The markers a tool row is made of, indentation kept (a nested call is indented). */
function rows(lines) {
	return lines.filter((line) =>
		/^\s*(codemode|\$ \S|✓ \w+ .*Nms$|\.\.\. \(\d+ (more lines|earlier calls)|Took \S+)/.test(line),
	);
}

const CRASH = /uncaughtException|To report this crash|TypeError:|ReferenceError:/;

const sessions = { pi: "ab-pi", ours: "ab-ours" };
const commands = {
	pi: `PI_CODING_AGENT_DIR=${agentDir} pi --provider ${provider} --model ${model}`,
	ours: `PI_CODING_AGENT_DIR=${agentDir} node ${join(root, "dist", "cli.js")} --provider ${provider} --model ${model}`,
};

async function run(scenario) {
	for (const [side, session] of Object.entries(sessions)) {
		try {
			tmux("kill-session", "-t", session);
		} catch {}
		tmux("new-session", "-d", "-s", session, "-x", "170", "-y", "60", "-c", root);
		tmux("send-keys", "-t", session, commands[side], "Enter");
	}
	await sleep(15_000);
	for (const [side, session] of Object.entries(sessions)) {
		for (const step of scenario.steps) {
			if (step.type !== undefined) {
				tmux("send-keys", "-l", "-t", session, "--", step.type);
			}
			if (step.send !== undefined) {
				// Literal, so `;`, quotes and parentheses reach the editor as typed.
				tmux("send-keys", "-l", "-t", session, "--", step.send);
				tmux("send-keys", "-t", session, "Enter");
			}
			if (step.key !== undefined) tmux("send-keys", "-t", session, step.key);
			await sleep(step.wait ?? 250);
		}
	}
	await sleep(scenario.wait);
	const captured = {};
	for (const [side, session] of Object.entries(sessions)) {
		const raw = tmux("capture-pane", "-p", "-t", session);
		captured[side] = { raw, lines: normalize(raw, Infinity), crashed: CRASH.test(raw) };
	}
	if (!keep) for (const session of Object.values(sessions)) try { tmux("kill-session", "-t", session); } catch {}
	const { pi: expected, ours: actual } = captured;
	const view = (entry) => {
		if (scenario.mode === "set") return entry.lines;
		if (scenario.mode === "rows") return rows(entry.lines);
		if (scenario.mode === "chrome") return entry.lines.filter((line) => /\(\w[\w-]*\) \S+ •|^>|^─{20,}$/.test(line)).slice(-4);
		return entry.lines.slice(-12);
	};
	const expectedView = view(expected);
	const actualView = view(actual);
	// A panel can be clipped at a different point; what matters is that neither side
	// shows a line the other does not.
	const missingFromOurs = expectedView.filter((line) => !actualView.includes(line));
	const missingFromTheirs = actualView.filter((line) => !expectedView.includes(line));
	const identical =
		scenario.mode === "set" || scenario.mode === "chrome"
			? missingFromOurs.length === 0 && missingFromTheirs.length === 0
			: expectedView.join("\n") === actualView.join("\n");
	return { scenario: scenario.name, identical, crashed: { pi: expected.crashed, ours: actual.crashed }, expectedView, actualView };
}

const selected = scenarios.filter((scenario) => {
	if (only !== undefined) return only.includes(scenario.name);
	return all || scenario.slow !== true;
});

if (argv.includes("--list")) {
	for (const scenario of selected) process.stdout.write(`${scenario.name}${scenario.slow ? " (slow)" : ""}\n`);
	process.exit(0);
}

process.stdout.write(`agent dir: ${agentDir}\nmodel: ${provider}/${model}\nscenarios: ${selected.length}\n\n`);
const results = [];
for (const scenario of selected) {
	const result = await run(scenario);
	results.push(result);
	const status = result.crashed.pi || result.crashed.ours ? "CRASH" : result.identical ? "pass" : "DIFF";
	process.stdout.write(`${status.padEnd(6)}${scenario.name}\n`);
	if (status !== "pass") {
		const expected = result.expectedView;
		const actual = result.actualView;
		const width = Math.max(expected.length, actual.length);
		const shown = [];
		for (let line = 0; line < width && shown.length < 8; line++) {
			if (expected[line] === actual[line]) continue;
			shown.push(`        pi:   ${expected[line] ?? "(absent)"}\n        ours: ${actual[line] ?? "(absent)"}`);
		}
		process.stdout.write(`${shown.join("\n")}\n`);
	}
}

const failed = results.filter((result) => !result.identical || result.crashed.pi || result.crashed.ours);
process.stdout.write(`\n${results.length - failed.length}/${results.length} identical\n`);
if (failed.length > 0) process.stdout.write(`differing: ${failed.map((result) => result.scenario).join(", ")}\n`);
process.exitCode = failed.length === 0 ? 0 : 1;
