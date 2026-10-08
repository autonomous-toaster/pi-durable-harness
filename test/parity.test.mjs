import assert from "node:assert/strict";
import { test } from "node:test";
import { createPromptExtension } from "../dist/harness/prompt.js";
import { HarnessSession } from "../dist/rpc/session.js";

const fakeModel = { name: "faux", provider: "faux", id: "faux-1" };

test("skills and project instructions are available to the model", async () => {
	const extension = createPromptExtension({
		agentsFiles: [{ path: "/repo/AGENTS.md", content: "Be careful." }],
		skills: [{ name: "demo", description: "A demo skill", filePath: "/repo/.pi/skills/demo/SKILL.md", baseDir: "/repo/.pi/skills/demo", sourceInfo: {}, disableModelInvocation: false }],
		systemPrompt: "You are a coding agent.",
		appendSystemPrompt: [],
	});
	const keys = extension.sections.map((section) => section.key);
	assert.ok(keys.includes("skills"));
	assert.ok(keys.includes("project_context"));
	const input = { env: { cwd: "/repo" }, agent: { cwd: "/repo" } };
	const project = await extension.sections.find((s) => s.key === "project_context").render(input);
	assert.match(project, /AGENTS\.md/);
	assert.match(project, /Be careful\./);
	const skills = await extension.sections.find((s) => s.key === "skills").render(input);
	assert.match(skills, /demo/);
});

test("direct bash streams output and injects session metadata", async () => {
	const engine = {
		resolvedAgent: async () => ({ model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: "off" }),
	};
	const session = new HarnessSession(engine, "kobo-7");
	const chunks = [];
	const result = await session.bash("printf '%s' \"$PI_SESSION_ID\"", (delta) => chunks.push(delta));
	assert.equal(result.output, "kobo-7");
	assert.equal(result.exitCode, 0);
	assert.equal(chunks.join(""), "kobo-7");
});

test("get_state matches the pinned pi response shape", async () => {
	const engine = {
		resolvedAgent: async () => ({ model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: "off" }),
		policy: async () => ({}),
		view: async () => ({ entries: [], docs: {} }),
	};
	const session = new HarnessSession(engine, "s1");
	const state = await session.state();
	const keys = Object.keys(state)
		.filter((key) => key !== "sessionFile")
		.sort();
	assert.deepEqual(keys, [
		"autoCompactionEnabled",
		"followUpMode",
		"isCompacting",
		"isStreaming",
		"messageCount",
		"model",
		"pendingMessageCount",
		"sessionId",
		"steeringMode",
		"thinkingLevel",
	]);
});
