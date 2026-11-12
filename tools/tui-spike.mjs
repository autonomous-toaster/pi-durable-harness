#!/usr/bin/env node
// Spike for tui-parity (tasks 1.1, 1.2): drive pi's InteractiveMode from the real
// durable engine, through the TUI adapter, and report what it asks for and how
// far it gets. A headless terminal means the render is a buffer, not a screen.
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { DefaultResourceLoader, ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { HarnessEngine } from "../dist/harness/engine.js";
import { createTuiRuntime } from "../dist/harness/tui/adapter.js";
import { resolveConfig } from "../dist/harness/config.js";

const asked = new Set();
const PROMPT = process.env.TUI_SPIKE_PROMPT ?? "Reply with exactly: ok";

/** Log every member the TUI reads, then answer from the adapter. */
function recording(target, label) {
	return new Proxy(target, {
		get(object, property, receiver) {
			if (typeof property === "symbol") return Reflect.get(object, property, receiver);
			asked.add(`${label}.${String(property)}`);
			return Reflect.get(object, property, receiver);
		},
	});
}

class HeadlessTerminal {
	#onInput;
	constructor() {
		this.output = [];
		this.columns = 120;
		this.rows = 40;
		this.kittyProtocolActive = false;
	}
	start(onInput) { this.#onInput = onInput; }
	stop() {}
	restoreOnExit() {}
	async drainInput() {}
	write(data) { this.output.push(data); }
	moveBy() {}
	hideCursor() {}
	showCursor() {}
	clearLine() {}
	clearFromCursor() {}
	clearScreen() {}
	setTitle() {}
	setProgress() {}
	setProgramStatus() {}
	get rendered() { return this.output.join(""); }
	type(data) { this.#onInput?.(data); }
}

const config = resolveConfig(
	["--mode", "rpc", "--no-session",
	 "--provider", process.env.TEST_LIVE_PROVIDER ?? "ollama-cloud",
	 "--model", process.env.TEST_LIVE_MODEL_ID ?? "deepseek-v4.1-flash:cloud"],
	process.env,
	process.cwd(),
);
const modelRuntime = await ModelRuntime.create();
const settingsManager = SettingsManager.create(config.cwd);
const loader = new DefaultResourceLoader({ cwd: config.cwd, agentDir: config.agentDir, settingsManager });
await loader.reload({ resolveProjectTrust: async () => false });
const resources = {
	cwd: config.cwd,
	agentsFiles: loader.getAgentsFiles().agentsFiles,
	skills: loader.getSkills().skills,
	prompts: loader.getPrompts().prompts,
	systemPrompt: loader.getSystemPrompt(),
	appendSystemPrompt: loader.getAppendSystemPrompt(),
};
const engine = await HarnessEngine.open({ config, key: "tui-spike", modelRuntime, settingsManager, resources });
const runtime = createTuiRuntime(engine, {
	cwd: config.cwd,
	sessionId: "tui-spike",
	settingsManager,
	resourceLoader: loader,
	modelRuntime,
	modelRegistry: new ModelRegistry(modelRuntime),
	thinkingLevel: "off",
	extensions: loader.getExtensions().extensions,
	terminal: undefined,
});
await runtime.refresh();
await runtime.startWatching();

const terminal = new HeadlessTerminal();
const mode = new InteractiveMode(recording(runtime, "runtime"), { terminal, verbose: false });
const running = mode.run().catch((error) => ({ error }));

await new Promise((resolve) => setTimeout(resolve, 1500));
terminal.type(PROMPT);
terminal.type("\r");

// Wait for the run to settle, then render again.
for (let attempt = 0; attempt < 120; attempt += 1) {
	await new Promise((resolve) => setTimeout(resolve, 500));
	if (await engine.isQuiescent()) break;
}
await new Promise((resolve) => setTimeout(resolve, 1500));

const result = await Promise.race([running, Promise.resolve(undefined)]);
const entries = await engine.entries();
const answer = await engine.lastAssistantText();
const plain = terminal.rendered
	.replaceAll(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
	.replaceAll(/\x1b\][^\x07]*\x07/g, "")
	.replaceAll(/\x1b_G[^\\]*\\/g, "");
process.stdout.write(`\n--- recorded members (${asked.size}) ---\n${[...asked].sort().join("\n")}\n`);
process.stdout.write(`\nentries: ${entries.length}  answer: ${JSON.stringify(answer)}\n`);
process.stdout.write(`\n--- rendered (plain, tail) ---\n${plain.slice(-2500)}\n`);
if (result?.error !== undefined) process.stdout.write(`\nMODE ERROR: ${result.error?.stack ?? result.error}\n`);
await engine.close().catch(() => {});
process.exit(0);
