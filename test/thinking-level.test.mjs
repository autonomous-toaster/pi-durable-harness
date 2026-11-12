import assert from "node:assert/strict";
import { after, test } from "node:test";

// `currentThinkingLevel` is synchronous and pi reads it for its footer and for
// `pi.getThinkingLevel()`. It was a stub returning undefined, so a /thinking
// change never showed until the next start.
const { resolveConfig } = await import("../dist/harness/config.js");
const { HarnessEngine } = await import("../dist/harness/engine.js");
const { DefaultResourceLoader, ModelRuntime, SettingsManager } = await import(
	"@earendil-works/pi-coding-agent"
);

const opened = [];

async function openEngine() {
	const config = resolveConfig(["--no-session"], process.env, process.cwd());
	const modelRuntime = await ModelRuntime.create();
	const settingsManager = SettingsManager.create(config.cwd);
	const loader = new DefaultResourceLoader({ cwd: config.cwd, agentDir: config.agentDir, settingsManager });
	await loader.reload({ resolveProjectTrust: async () => false });
	const engine = await HarnessEngine.open({
		config,
		key: `thinking-${opened.length}`,
		modelRuntime,
		settingsManager,
		resources: { cwd: config.cwd, agentsFiles: [], skills: [], prompts: [], systemPrompt: "", appendSystemPrompt: "" },
	});
	opened.push(engine);
	return engine;
}

after(async () => {
	for (const engine of opened) await engine.close().catch(() => {});
});

test("the engine reports the thinking level it opened with", async () => {
	const engine = await openEngine();
	assert.notEqual(engine.currentThinkingLevel(), undefined);
	assert.equal(engine.currentThinkingLevel(), (await engine.resolvedAgent()).thinkingLevel);
});

test("configure updates the synchronous level, as /thinking does", async () => {
	const engine = await openEngine();
	await engine.configure({ thinkingLevel: "high" });
	assert.equal(engine.currentThinkingLevel(), "high");
	assert.equal((await engine.resolvedAgent()).thinkingLevel, "high");
	await engine.configure({ thinkingLevel: "off" });
	assert.equal(engine.currentThinkingLevel(), "off");
});
