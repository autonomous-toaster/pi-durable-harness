/**
 * One extension context for tools, commands, and session handlers (tasks 5.1-5.3).
 *
 * pi gives every extension surface the same `ExtensionContext`. The harness used
 * to build three different objects, so a tool had no `sessionManager` and a
 * command handler got `{}` and threw on `ctx.ui.notify`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { emptySnapshot, createSessionManager } from "../dist/extensions/actions.js";
import { createExtensionContext, emptySessionManager } from "../dist/extensions/context.js";
import { translateExtension } from "../dist/extensions/host.js";
import { setUiClient } from "../dist/rpc/ui-bridge.js";

/** A pi extension record holding one tool that reads its context. */
function fixtureExtension() {
	const definition = {
		name: "whoami",
		description: "Reads the session id from the context",
		parameters: { type: "object", properties: {} },
		execute: async (_id, _params, _signal, _onUpdate, ctx) => ({
			content: [{ type: "text", text: String(ctx.sessionManager.getSessionId()) }],
		}),
	};
	return {
		path: "fixture",
		tools: new Map([["whoami", { definition }]]),
		handlers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

test("a tool reads the session id a handler sees", async () => {
	const snapshot = emptySnapshot();
	const durable = translateExtension(fixtureExtension(), async () => createSessionManager(snapshot, "s1"));
	const result = await durable.tools[0].execute({}, { env: { cwd: "/work" } }, {});
	assert.equal(result.output[0].text, "s1");
});

test("a tool without a session view still gets one", async () => {
	const durable = translateExtension(fixtureExtension());
	const result = await durable.tools[0].execute({}, { env: { cwd: "/work" } }, {});
	assert.equal(result.output[0].text, "");
});

test("the command context carries a ui and a session view", () => {
	const context = createExtensionContext({
		cwd: "/work",
		sessionManager: createSessionManager(emptySnapshot(), "s2"),
	});
	assert.equal(context.mode, "rpc");
	assert.equal(context.cwd, "/work");
	assert.equal(context.sessionManager.getSessionId(), "s2");
	// What `pi-openwebui`'s /openwebui command does.
	assert.doesNotThrow(() => context.ui.notify("Open WebUI: connected", "info"));
});

test("hasUI reports the attached client", () => {
	setUiClient(undefined);
	const context = createExtensionContext({ cwd: "/work", sessionManager: emptySessionManager() });
	assert.equal(context.hasUI, false);
	setUiClient(async () => ({ cancelled: true }));
	try {
		assert.equal(context.hasUI, true);
	} finally {
		setUiClient(undefined);
	}
	assert.equal(context.hasUI, false);
});
