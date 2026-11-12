import assert from "node:assert/strict";
import { test } from "node:test";
import { computeActivation, computeDeclaredTools } from "../dist/tools/activate.js";

const tool = (name) => ({ name, description: name, parameters: {} });
const all = ["read", "bash", "edit", "write", "codemode", "tool_search"].map(tool);

// pi's `codemode.mode` decides what the model sees directly. "only" presents every
// tool through codemode and declares no direct tool; "on" keeps them declared.
test('mode "only" declares codemode alone', () => {
	const activation = computeActivation([], true, [], "only");
	assert.equal(activation.codemode, true);
	const declared = computeDeclaredTools(all, activation, [], "only").map((entry) => entry.name);
	assert.deepEqual(declared, ["codemode"]);
});

test('mode "on" keeps the direct tools declared', () => {
	// codemode activates on demand, so it is asked for explicitly here.
	const activation = computeActivation([], true, ["+codemode"], "on");
	const declared = computeDeclaredTools(all, activation, ["+codemode"], "on").map((entry) => entry.name);
	assert.deepEqual(declared, ["read", "bash", "edit", "write", "codemode"]);
});

test('an explicit "+name" still wins under mode "only"', () => {
	const activation = computeActivation([], true, ["+bash"], "only");
	const declared = computeDeclaredTools(all, activation, ["+bash"], "only").map((entry) => entry.name);
	assert.deepEqual(declared, ["bash", "codemode"]);
});
