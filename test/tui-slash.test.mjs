import assert from "node:assert/strict";
import { test } from "node:test";
import {
	expandPromptTemplate,
	expandSkillCommand,
	parseCommandArgs,
	stripFrontmatter,
	substituteArgs,
} from "../dist/harness/tui/slash.js";

const template = { name: "deepsearch", content: "Research $ARGUMENTS for ${2:-none} then $1." };
const skill = { name: "commit", filePath: "/skills/commit/SKILL.md", baseDir: "/skills/commit" };
const read = () => "---\nname: commit\n---\n\nWrite the message.\n";

test("a prompt template expands its arguments, as pi does", () => {
	// `${2:-none}` yields the second argument when there is one; `$1` is the first.
	assert.equal(expandPromptTemplate("/deepsearch mcp servers", [template]), "Research mcp servers for servers then mcp.");
	assert.equal(expandPromptTemplate('/deepsearch "two words" second', [template]), "Research two words second for second then two words.");
	assert.equal(expandPromptTemplate("/deepsearch alone", [template]), "Research alone for none then alone.");
});

test("an unknown or non-slash prompt is passed through unchanged", () => {
	assert.equal(expandPromptTemplate("/unknown hi", [template]), "/unknown hi");
	assert.equal(expandPromptTemplate("hello", [template]), "hello");
});

test("a skill command becomes the skill block pi sends", () => {
	assert.equal(
		expandSkillCommand("/skill:commit", [skill], read),
		`<skill name="commit" location="/skills/commit/SKILL.md">\nReferences are relative to /skills/commit.\n\nWrite the message.\n</skill>`,
	);
	assert.match(expandSkillCommand("/skill:commit also tag", [skill], read), /<\/skill>\n\nalso tag$/);
	assert.equal(expandSkillCommand("/skill:missing", [skill], read), "/skill:missing");
});

test("arguments split and substitute the way pi's own do", () => {
	assert.deepEqual(parseCommandArgs(`a "b c" 'd e'`), ["a", "b c", "d e"]);
	assert.equal(substituteArgs("[${@:2}] [${@:1:2}] [${4:-fallback}] [$9] [$1]", ["a", "b", "c"]), "[b c] [a b] [fallback] [] [a]");
	// An unclosed quote stays literal, as in pi.
	assert.deepEqual(parseCommandArgs('x "y'), ["x", '"y']);
	assert.equal(stripFrontmatter("---\nname: x\n---\nbody"), "body");
});
