import assert from "node:assert/strict";
import { test } from "node:test";
import { computeActivation, computeDeclaredTools } from "../dist/tools/activate.js";
import { setMcpEntries } from "../dist/tools/state.js";

const server = (name, exposure, toolExposure = {}) => ({ name, enabled: true, exposure, toolExposure, transport: {} });

function entry(name, serverName, exposure) {
	return {
		name,
		server: serverName,
		toolName: name,
		exposure,
		description: name,
		inputSchema: undefined,
		outputSchema: undefined,
		annotations: undefined,
		registration: fakeTool(name),
	};
}

const fakeTool = (name) => ({ name, description: name });

test("no servers leaves codemode and tool_search inactive", () => {
	const activation = computeActivation([], true, []);
	assert.equal(activation.codemode, false);
	assert.equal(activation.toolSearch, false);
	assert.deepEqual(activation.warnings, []);
});

test("a codemode server activates codemode", () => {
	assert.equal(computeActivation([server("s", "codemode")], true, []).codemode, true);
	assert.equal(computeActivation([server("s", "codemode-deferred")], true, []).codemode, true);
});

test("autoEnableCodemode false keeps codemode inactive and warns", () => {
	const activation = computeActivation([server("s", "codemode")], false, []);
	assert.equal(activation.codemode, false);
	assert.equal(activation.warnings.length, 1);
});

test("a deferred server activates tool_search", () => {
	const activation = computeActivation([server("s", "deferred")], true, []);
	assert.equal(activation.toolSearch, true);
	assert.equal(activation.codemode, false);
});

test("defaultTools can force codemode and tool_search", () => {
	const activation = computeActivation([], true, ["+codemode", "+tool_search"]);
	assert.equal(activation.codemode, true);
	assert.equal(activation.toolSearch, true);
});

test("the declared set keeps built-ins and direct tools and drops codemode and hidden ones", () => {
	setMcpEntries([
		entry("mcp__s__direct", "s", "direct"),
		entry("mcp__s__codemode", "s", "codemode"),
		entry("mcp__s__deferred", "s", "deferred"),
		entry("mcp__s__hidden", "s", "hidden"),
	]);
	const all = [
		fakeTool("read"),
		fakeTool("bash"),
		fakeTool("ls"),
		fakeTool("codemode"),
		fakeTool("tool_search"),
		fakeTool("mcp__s__direct"),
		fakeTool("mcp__s__codemode"),
		fakeTool("mcp__s__deferred"),
		fakeTool("mcp__s__hidden"),
	];
	const declared = computeDeclaredTools(all, { codemode: true, toolSearch: true, warnings: [] }).map((tool) => tool.name);
	assert.deepEqual(declared, ["read", "bash", "codemode", "tool_search", "mcp__s__direct"]);
});

test("codemode and tool_search are dropped from the declared set when inactive", () => {
	setMcpEntries([]);
	const declared = computeDeclaredTools([fakeTool("read"), fakeTool("codemode"), fakeTool("tool_search")], {
		codemode: false,
		toolSearch: false,
		warnings: [],
	});
	assert.deepEqual(declared.map((tool) => tool.name), ["read"]);
});
