/**
 * `codemode.mode: "only"` (the regression that cost a session 13 turns).
 *
 * "Only" hides the direct tools from the model and keeps them usable inside codemode. A session that
 * conflated the two declared codemode and nothing else, and codemode contained no built-in, so the
 * model could not read, run, or edit anything: every codemode call failed with `tools.bash does not
 * exist`, and the run was aborted after thirteen attempts.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

const { HarnessEngine } = await import("../dist/harness/engine.js");
const { resolveConfig } = await import("../dist/harness/config.js");

async function engineWithMode(mode, defaultTools = []) {
	const dir = mkdtempSync(join(tmpdir(), "pi-only-"));
	writeFileSync(join(dir, "settings.json"), JSON.stringify({ codemode: { mode }, defaultTools }), "utf8");
	const config = resolveConfig(["--session-dir", dir, "--session-id", `only-${mode}`], {}, dir, false);
	const engine = await HarnessEngine.open({
		config,
		key: `only-${mode}`,
		modelRuntime: await ModelRuntime.create(),
		settingsManager: SettingsManager.create(dir, dir),
		resources: { skills: [], prompts: [], systemPrompt: undefined, appendSystemPrompt: [] },
	});
	const description = String(engine.toolRegistrations().find((tool) => tool.name === "codemode")?.description ?? "");
	const agent = await engine.resolvedAgent();
	return { engine, declared: (agent.tools ?? []).map((tool) => tool.name), description };
}

test("mode 'only' declares codemode alone, and codemode contains the built-ins", async () => {
	const { engine, declared, description } = await engineWithMode("only");
	try {
		assert.deepEqual(declared, ["codemode"], `declared: ${declared.join(", ")}`);
		// The catalogue codemode renders is what a script can call: the built-ins must be in it.
		for (const name of ["bash", "read", "edit", "write"]) {
			assert.match(description, new RegExp(`\\b${name}\\b`), `codemode must list ${name}`);
		}
	} finally {
		await engine.close();
	}
});

test("mode 'on' declares the built-ins and leaves codemode to the indirect tools", async () => {
	// `+codemode` forces it active without an MCP server, which is the case this asserts.
	const { engine, declared, description } = await engineWithMode("on", ["+codemode"]);
	try {
		for (const name of ["bash", "read", "edit", "write", "codemode"]) assert.ok(declared.includes(name), `declared: ${declared.join(", ")}`);
		// No MCP server here, so codemode has nothing to list.
		assert.equal(description.includes("bash"), false, "a directly declared tool is not repeated in codemode");
	} finally {
		await engine.close();
	}
});
