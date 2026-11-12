/**
 * Sandbox selection (bundle parity): the worker keeps the VM off the event loop
 * where a worker file exists; a single-file bundle has none, so it runs the VM
 * inline from the wasm the bundle carries.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { InlineCodemodeSandbox, loadQuickJSWasm } from "@earendil-works/pi-codemode";
import { createSandbox } from "../dist/tools/codemode.js";

test("the dist build selects the worker sandbox", async () => {
	const sandbox = await createSandbox();
	assert.equal(sandbox.constructor.name, "CodemodeSandbox");
	await sandbox.close();
});

test("the inline fallback runs a script from the wasm it is given", async () => {
	const sandbox = new InlineCodemodeSandbox({ wasm: loadQuickJSWasm() });
	try {
		const result = await sandbox.execute("text(String(6 * 7));");
		assert.equal(result.ok, true);
		assert.match(JSON.stringify(result.output), /42/);
	} finally {
		await sandbox.close();
	}
});
