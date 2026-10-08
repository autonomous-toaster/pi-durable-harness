import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeMcpFiles, resolveMcpSettings, resolveToolExposure, serverReaches } from "../dist/tools/exposure.js";

test("a project transport replaces the global server", () => {
	const merged = mergeMcpFiles(
		{ mcpServers: { s: { command: "a", exposure: "direct" } } },
		{ mcpServers: { s: { command: "b" } } },
	);
	assert.equal(merged.servers.s.command, "b");
	assert.equal(merged.servers.s.exposure, undefined);
});

test("a project override without a transport changes only enabled, exposure, and toolExposure", () => {
	const merged = mergeMcpFiles(
		{ mcpServers: { s: { command: "a", args: ["x"], exposure: "direct", enabled: true } } },
		{ mcpServers: { s: { exposure: "deferred", enabled: false, toolExposure: { get_x: "direct" } } } },
	);
	assert.equal(merged.servers.s.command, "a");
	assert.deepEqual(merged.servers.s.args, ["x"]);
	assert.equal(merged.servers.s.exposure, "deferred");
	assert.equal(merged.servers.s.enabled, false);
	assert.deepEqual(merged.servers.s.toolExposure, { get_x: "direct" });
});

test("autoEnableCodemode prefers the project value", () => {
	assert.equal(mergeMcpFiles({ autoEnableCodemode: true }, { autoEnableCodemode: false }).autoEnableCodemode, false);
	assert.equal(mergeMcpFiles({ autoEnableCodemode: true }, {}).autoEnableCodemode, true);
});

test("server exposure defaults to codemode and invalid values warn", () => {
	const settings = resolveMcpSettings({ mcpServers: { a: {}, b: { exposure: "bogus" } } });
	assert.equal(settings.servers[0].exposure, "codemode");
	assert.equal(settings.servers[0].enabled, true);
	assert.equal(settings.servers[1].exposure, "codemode");
	assert.equal(settings.warnings.length, 1);
});

test("an exact toolExposure name wins over a pattern", () => {
	const [server] = resolveMcpSettings({ mcpServers: { s: { exposure: "deferred", toolExposure: { "get_*": "codemode", get_x: "direct" } } } }).servers;
	assert.equal(resolveToolExposure(server, "get_x"), "direct");
	assert.equal(resolveToolExposure(server, "get_y"), "codemode");
	assert.equal(resolveToolExposure(server, "other"), "deferred");
});

test("a hidden server exposes only the tools it lists", () => {
	const [server] = resolveMcpSettings({ mcpServers: { s: { exposure: "hidden", toolExposure: { "get_*": "codemode" } } } }).servers;
	assert.equal(resolveToolExposure(server, "get_x"), "codemode");
	assert.equal(resolveToolExposure(server, "list_x"), "hidden");
});

test("serverReaches reports the reaching tool", () => {
	const [codemodeServer] = resolveMcpSettings({ mcpServers: { s: { exposure: "codemode-deferred" } } }).servers;
	assert.deepEqual(serverReaches(codemodeServer), { codemode: true, toolSearch: false });
	const [deferredServer] = resolveMcpSettings({ mcpServers: { s: { exposure: "deferred" } } }).servers;
	assert.deepEqual(serverReaches(deferredServer), { codemode: false, toolSearch: true });
	const [directServer] = resolveMcpSettings({ mcpServers: { s: { exposure: "direct" } } }).servers;
	assert.deepEqual(serverReaches(directServer), { codemode: false, toolSearch: false });
});
