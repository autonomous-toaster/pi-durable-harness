/**
 * The extension UI bridge and the RPC dialog round trip (tasks 3.1-3.4, 4.2).
 *
 * The round trip runs without a model: the server is driven directly over a
 * pipe pair, so a dialog request, its answer, an unknown id, a timeout, an
 * abort, and a cancelled-on-close all take the real code path.
 */
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { RpcServer } from "../dist/rpc/server.js";
import { dialogMethods, hasUiClient, setUiClient } from "../dist/rpc/ui-bridge.js";

/** A server whose session only answers `get_state` and holds an event sink. */
function fakeSession() {
	return {
		startEvents: async () => async () => {},
		state: async () => ({ sessionId: "s1", messageCount: 0 }),
	};
}

/** Collect complete JSONL records written by the server. */
function recordReader(stream) {
	const records = [];
	const waiters = [];
	let buffer = "";
	stream.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		let at;
		while ((at = buffer.indexOf("\n")) !== -1) {
			const line = buffer.slice(0, at);
			buffer = buffer.slice(at + 1);
			if (line.length === 0) continue;
			records.push(JSON.parse(line));
			for (const waiter of waiters.splice(0)) waiter();
		}
	});
	return async function next(predicate = () => true) {
		for (;;) {
			const found = records.find(predicate);
			if (found !== undefined) return found;
			await new Promise((resolve) => waiters.push(resolve));
		}
	};
}

/** Start a server and wait until it is the one answering dialogs. */
async function startServer() {
	setUiClient(undefined);
	const input = new PassThrough();
	const output = new PassThrough();
	const next = recordReader(output);
	const server = new RpcServer(fakeSession(), input, output);
	const running = server.run();
	for (let attempt = 0; attempt < 500 && !hasUiClient(); attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	assert.equal(hasUiClient(), true, "the server attached itself as the dialog client");
	return { input, next, running };
}

test("the bridge sends pi's envelope and resolves the answer", async () => {
	const seen = [];
	setUiClient(async (request) => {
		seen.push(request);
		return { value: "Allow" };
	});
	try {
		assert.equal(hasUiClient(), true);
		const chosen = await dialogMethods().select("Allow dangerous command?", ["Allow", "Block"], { timeout: 250 });
		assert.equal(chosen, "Allow");
		assert.equal(seen[0].method, "select");
		assert.deepEqual(seen[0].payload, { title: "Allow dangerous command?", options: ["Allow", "Block"] });
		assert.equal(seen[0].timeout, 250);
	} finally {
		setUiClient(undefined);
	}
	assert.equal(hasUiClient(), false);
});

test("without a client a dialog is cancelled and confirm is false", async () => {
	setUiClient(undefined);
	assert.deepEqual(await dialogMethods().select("t", ["a"]), undefined);
	assert.equal(await dialogMethods().confirm("t", "m"), false);
	assert.equal(await dialogMethods().input("t"), undefined);
	assert.equal(await dialogMethods().editor("t"), undefined);
});

test("the server answers a dialog and keeps serving an unknown response", async () => {
	const { input, next, running } = await startServer();
	try {
		const pending = dialogMethods().confirm("Clear session?", "All messages will be lost.");
		const request = await next((record) => record.type === "extension_ui_request");
		assert.equal(request.method, "confirm");
		assert.equal(request.title, "Clear session?");
		assert.equal(request.message, "All messages will be lost.");
		input.write(`${JSON.stringify({ type: "extension_ui_response", id: request.id, confirmed: true })}\n`);
		assert.equal(await pending, true);

		// An unknown id changes nothing and does not end the process.
		input.write(`${JSON.stringify({ type: "extension_ui_response", id: "nope", confirmed: false })}\n`);
		input.write(`${JSON.stringify({ id: "s1", type: "get_state" })}\n`);
		const response = await next((record) => record.type === "response" && record.id === "s1");
		assert.equal(response.success, true);
	} finally {
		input.end();
		await running;
	}
});

test("a dialog with a timeout settles cancelled", async () => {
	const { input, next, running } = await startServer();
	try {
		const pending = dialogMethods().select("Pick one", ["a", "b"], { timeout: 5 });
		const request = await next((record) => record.type === "extension_ui_request");
		assert.equal(request.timeout, 5);
		assert.equal(await pending, undefined);
	} finally {
		input.end();
		await running;
	}
});

test("an abort settles a pending dialog", async () => {
	const { input, next, running } = await startServer();
	try {
		const pending = dialogMethods().input("Name?");
		await next((record) => record.type === "extension_ui_request");
		input.write(`${JSON.stringify({ id: "a1", type: "abort" })}\n`);
		assert.equal(await pending, undefined);
		await next((record) => record.type === "response" && record.id === "a1");
	} finally {
		input.end();
		await running;
	}
});

test("a dialog pending when the input closes settles cancelled", async () => {
	const { input, next, running } = await startServer();
	const pending = dialogMethods().input("Name?");
	await next((record) => record.type === "extension_ui_request");
	input.end();
	assert.equal(await pending, undefined);
	await running;
});
