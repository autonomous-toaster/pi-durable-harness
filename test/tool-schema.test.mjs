import assert from "node:assert/strict";
import { test } from "node:test";
import { num, obj, opt, str } from "@earendil-works/pi-schema";
import { compile } from "@earendil-works/pi-schema";

const schema = obj({ path: str(), limit: opt(num()) });

test("pi-schema coercion converts a numeric string argument", () => {
	const validator = compile(schema, { coerce: true });
	const parsed = validator.parse({ path: "a", limit: "42" });
	assert.equal(parsed.ok, true);
	assert.deepEqual(parsed.value, { path: "a", limit: 42 });
});

test("pi-schema rejects a missing required argument", () => {
	const validator = compile(schema, { coerce: true });
	const result = validator.validate({ limit: 1 });
	assert.notEqual(result.ok, true);
});

// The session that motivated this: `codemode.mode: "only"` declared codemode as the only tool and
// made every built-in uncallable inside it, so a run of 13 turns could not run a single command.
test("mode 'only' hides direct tools from the model but keeps them callable in a script", async () => {
	const { codemodeScope, codemodeCallable, computeActivation } = await import("../dist/tools/activate.js");
	const tool = (name) => ({ name, description: `${name} tool`, parameters: {}, execute: async () => ({ content: [] }) });
	const tools = ["read", "bash", "edit", "write", "codemode", "tool_search", "mcp__x__do"].map(tool);
	const activation = computeActivation([], true, [], "only");
	const scope = codemodeScope(tools, activation, [], "only");

	// What the model is told: codemode only (pi's "only" promise).
	assert.deepEqual(scope.declared.map((t) => t.name), ["codemode"]);
	// What a script may call: every direct tool the session would have had.
	for (const name of ["read", "bash", "edit", "write"]) {
		assert.ok(scope.active.some((t) => t.name === name), `${name} must stay active`);
	}
	// And what codemode lists: those tools, plus the tools kept out of declarations.
	const callable = codemodeCallable(tools, scope, new Set(["mcp__x__do"]), "only").map((t) => t.name);
	assert.ok(callable.includes("bash"));
	assert.ok(callable.includes("read"));
	assert.ok(callable.includes("mcp__x__do"));
	assert.ok(!callable.includes("codemode"));
	assert.ok(!callable.includes("tool_search"));

	// Mode "on" declares the direct tools, so codemode lists only the indirect ones.
	const onScope = codemodeScope(tools, computeActivation([], true, [], "on"), [], "on");
	assert.ok(onScope.declared.some((t) => t.name === "bash"));
	assert.deepEqual(codemodeCallable(tools, onScope, new Set(["mcp__x__do"]), "on").map((t) => t.name), ["mcp__x__do"]);
});
