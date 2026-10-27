import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { expandSkillCommand, skillCommands } from "../dist/harness/skills.js";

const SKILL_MD = `---
name: demo
description: A demo skill
---

# Demo

Follow these steps.
`;

async function skillOnDisk(overrides = {}) {
	const dir = await mkdtemp(join(tmpdir(), "skill-"));
	const filePath = join(dir, "SKILL.md");
	await writeFile(filePath, SKILL_MD);
	return {
		name: "demo",
		description: "A demo skill",
		filePath,
		baseDir: dir,
		sourceInfo: { source: "project" },
		disableModelInvocation: false,
		...overrides,
	};
}

test("each loaded skill is listed as one skill command (task 2.1)", async () => {
	const skill = await skillOnDisk();
	const commands = skillCommands([skill]);
	assert.equal(commands.length, 1);
	assert.equal(commands[0].name, "skill:demo");
	assert.equal(commands[0].description, "A demo skill");
	assert.equal(commands[0].source, "skill");
});

test("a listed command carries pi's command shape (task 2.2)", async () => {
	const skill = await skillOnDisk();
	const command = skillCommands([skill])[0];
	assert.deepEqual(Object.keys(command).sort(), ["description", "name", "source", "sourceInfo"]);
	assert.equal(typeof command.sourceInfo, "object");
});

test("a skill command expands to the SKILL.md body and its arguments (task 2.3)", async () => {
	const skill = await skillOnDisk();
	const expanded = expandSkillCommand("/skill:demo do the thing", [skill]);
	assert.match(expanded, /<skill name="demo"/);
	assert.match(expanded, /Follow these steps\./);
	assert.match(expanded, /do the thing$/);
	assert.doesNotMatch(expanded, /^---/m, "frontmatter is stripped");
});

test("a plain message and an unknown skill pass through unchanged (task 2.3)", async () => {
	const skill = await skillOnDisk();
	assert.equal(expandSkillCommand("hello", [skill]), "hello");
	assert.equal(expandSkillCommand("/skill:nope go", [skill]), "/skill:nope go");
});

test("a command-invocable skill stays invocable but leaves the model listing (task 2.4)", async () => {
	const skill = await skillOnDisk({ disableModelInvocation: true });
	// Listed for command invocation, as pi does for every loaded skill.
	const commands = skillCommands([skill]);
	assert.deepEqual(
		commands.map((command) => command.name),
		["skill:demo"],
	);
	// Still expandable through the explicit command.
	const expanded = expandSkillCommand("/skill:demo", [skill]);
	assert.match(expanded, /Follow these steps\./);
	// The prompt builder hides it from model selection.
	const { formatSkillsForPrompt } = await import("@earendil-works/pi-coding-agent");
	assert.equal(formatSkillsForPrompt([skill], "read"), "");
});
