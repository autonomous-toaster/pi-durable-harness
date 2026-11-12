import assert from "node:assert/strict";
import { test } from "node:test";
import { PiCodingTools } from "../dist/tools/index.js";
import { PI_TOOL_OUTPUT_SCHEMAS } from "../dist/tools/pi-definitions.js";

// A script's value comes from the program channel (`structuredOutput`), which the
// tool must declare. Without the declaration codemode falls back to the text — and
// bash keeps its output on the structured channel, so scripts saw "".
test("the coding tools declare the schemas codemode reads script values from", () => {
	const declared = new Map(PiCodingTools.tools.map((tool) => [tool.name, tool]));
	for (const name of ["read", "bash", "edit", "write"]) {
		const schema = PI_TOOL_OUTPUT_SCHEMAS[name];
		if (schema === undefined) continue;
		assert.notEqual(declared.get(name)?.structuredOutputSchema, undefined, `${name} declares structuredOutputSchema`);
	}
});
