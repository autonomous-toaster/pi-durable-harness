#!/usr/bin/env node
// Spike for tui-parity (tasks 1.1, 1.2): boot pi's InteractiveMode against a
// recording runtime and report which members it asks for, so the adapter's real
// surface is measured instead of read off the class declarations.
//
// The services are pi's own (SettingsManager, DefaultResourceLoader,
// ModelRuntime); only `session` and `sessionManager` are fakes. The terminal is
// headless, so the TUI renders into a buffer.
import { InteractiveMode, ModelRuntime, SettingsManager, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const asked = new Set();
const booleans = /^(is[A-Z]|has[A-Z]|auto[A-Z]|uses[A-Z])/;
/** Members the TUI calls; the rest are read as values. */
const calls = {
	session: new Set([
		"prompt", "steer", "followUp", "abort", "clearQueue", "setModel", "setThinkingLevel", "setScopedModels",
		"getAvailableThinkingLevels", "getContextUsage", "getActiveToolNames", "setActiveToolsByName", "getAllTools",
		"getToolDefinition", "getCallableToolNames", "rename", "navigateTree", "sendCustomMessage", "sendUserMessage",
		"refreshContext", "subscribe", "dispose", "getSteeringMessages", "getFollowUpMessages", "parseSkillBlock",
	]),
	sessionManager: new Set([
		"getEntries", "getBranch", "getTree", "buildContextEntries", "appendCustomEntry", "appendLabelChange",
		"getSessionId", "getSessionName", "getSessionFile", "getSessionDir", "getCwd", "getEntryCount", "getLeafId",
	]),
	services: new Set([]),
	"services.extensionRunner": new Set(["emit", "getToolRenderers", "getMessageRenderers"]),
	"session.state": new Set([]),
	"session.agent": new Set([]),
	runtime: new Set([
		"setBeforeSessionInvalidate", "setRebindSession", "switchSession", "newSession", "fork", "importFromJsonl", "dispose",
	]),
};

/** A benign value for a read member, chosen from its name. */
function defaultFor(name) {
	if (booleans.test(name)) return false;
	if (/s$/.test(name) || name === "messages") return [];
	return undefined;
}

/** Log every member read, and answer with something an early boot can survive. */
function recording(label, overrides = {}) {
	return new Proxy(overrides, {
		get(target, property) {
			if (typeof property === "symbol") return target[property];
			const name = String(property);
			if (Object.hasOwn(target, name)) return target[name];
			asked.add(`${label}.${name}`);
			if (calls[label]?.has(name)) {
				// A call: answer with what its name promises.
				return (..._args) => (name === "subscribe" ? () => {} : name.startsWith("get") || name === "buildContextEntries" ? [] : undefined);
			}
			const value = defaultFor(name);
			if (value !== undefined) return value;
			return undefined;
		},
		has() {
			return true;
		},
	});
}

class HeadlessTerminal {
	#onInput;
	#onResize;
	constructor() {
		this.output = [];
		this.columns = 120;
		this.rows = 40;
		this.kittyProtocolActive = false;
	}
	start(onInput, onResize) {
		this.#onInput = onInput;
		this.#onResize = onResize;
	}
	stop() {}
	restoreOnExit() {}
	async drainInput() {}
	write(data) {
		this.output.push(data);
	}
	moveBy() {}
	hideCursor() {}
	showCursor() {}
	clearLine() {}
	clearFromCursor() {}
	clearScreen() {}
	setTitle() {}
	setProgress() {}
	setProgramStatus() {}
	get rendered() {
		return this.output.join("");
	}
	type(data) {
		this.#onInput?.(data);
	}
	resize() {
		this.#onResize?.();
	}
}

const cwd = process.cwd();
const modelRuntime = await ModelRuntime.create();
const settingsManager = SettingsManager.create(cwd);
const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: `${process.env.HOME}/.pi/agent`, settingsManager });
await resourceLoader.reload({ resolveProjectTrust: async () => false });

const services = recording("services", {
	settingsManager,
	resourceLoader,
	modelRuntime,
	extensionRunner: recording("services.extensionRunner"),
});
const sessionManager = recording("sessionManager", { getCwd: () => cwd, getSessionId: () => "spike" });
const session = recording("session", {
	sessionManager,
	modelRuntime,
	resourceLoader,
	settingsManager,
	cwd,
	sessionFile: undefined,
	sessionName: undefined,
	state: recording("session.state"),
	agent: recording("session.agent"),
	extensionRunner: services.extensionRunner,
});
const runtimeHost = recording("runtime", {
	cwd,
	session,
	services,
	sessionManager,
	diagnostics: [],
	modelFallbackMessage: undefined,
});

const terminal = new HeadlessTerminal();
const mode = new InteractiveMode(runtimeHost, { terminal, verbose: false });
let failure;
try {
	await Promise.race([mode.run(), new Promise((resolve) => setTimeout(resolve, 3000))]);
} catch (error) {
	failure = error;
} finally {
	await mode.dispose?.();
}

const names = [...asked].sort();
process.stdout.write(`\nTUI requested ${names.length} members:\n`);
for (const name of names) process.stdout.write(`  ${name}\n`);
if (failure !== undefined) {
	process.stdout.write(`\nfirst failure: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
	process.exitCode = 1;
}
