import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { findTool, grepTool, lsTool } from "../dist/tools/index.js";

const context = BACKGROUND_CONTEXT;

async function workspace() {
	const dir = await mkdtemp(join(tmpdir(), "harness-tools-"));
	await writeFile(join(dir, "alpha.txt"), "hello world\n");
	await writeFile(join(dir, "beta.md"), "goodbye\n");
	await mkdir(join(dir, "sub"));
	await writeFile(join(dir, "sub", "gamma.txt"), "hello again\n");
	return { dir, env: new NodeExecutionEnv({ cwd: dir }) };
}

function body(result) {
	return result.content.map((block) => block.text).join("");
}

test("ls lists directory entries", async () => {
	const { dir, env } = await workspace();
	try {
		const result = await lsTool.execute({ path: "." }, { env }, context);
		const text = body(result);
		assert.match(text, /alpha\.txt/);
		assert.match(text, /beta\.md/);
		assert.match(text, /sub/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("find matches files by pattern", async () => {
	const { dir, env } = await workspace();
	try {
		const result = await findTool.execute({ pattern: "*.txt", path: "." }, { env }, context);
		const text = body(result);
		assert.match(text, /alpha\.txt/);
		assert.match(text, /gamma\.txt/);
		assert.doesNotMatch(text, /beta\.md/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("grep searches contents and treats no match as empty", async () => {
	const { dir, env } = await workspace();
	try {
		const hit = body(await grepTool.execute({ pattern: "hello", path: "." }, { env }, context));
		assert.match(hit, /alpha\.txt/);
		assert.match(hit, /gamma\.txt/);
		const miss = await grepTool.execute({ pattern: "does-not-exist", path: "." }, { env }, context);
		assert.equal(body(miss), "");
		assert.notEqual(miss.isError, true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
