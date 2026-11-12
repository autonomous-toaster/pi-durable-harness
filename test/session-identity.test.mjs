/**
 * Session identity and the SQLite layout (tasks 1.1-1.6, 2.1, 2.4, 4.1).
 *
 * The container is the session; the working directory groups and the tenant
 * labels. These drive the built CLI so the resolution, the path, and the
 * reported id are all exercised together.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolveConfig } from "../dist/harness/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Run one RPC command and resolve with its response and the process exit code. */
function rpc(args, sessionDir, timeoutMs = 20_000) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(root, "dist", "cli.js"), "--mode", "rpc", "--session-dir", sessionDir, ...args], {
			cwd: root,
			env: { ...process.env, PI_OFFLINE: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const records = [];
		let buffer = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`timeout; stderr: ${stderr.slice(-300)}`));
		}, timeoutMs);
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			let at;
			while ((at = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
				if (line.length === 0) continue;
				records.push(JSON.parse(line));
			}
		});
		child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
		child.on("error", reject);
		child.on("close", (code) => {
			clearTimeout(timer);
			const response = records.find((record) => record.type === "response" && record.id === "s1");
			resolve({ response, code, stderr });
		});
		child.stdin.write(`${JSON.stringify({ id: "s1", type: "get_state" })}\n`);
		setTimeout(() => child.stdin.end(), 1200);
	});
}

/** Every session file under a session directory, relative to it. */
async function files(sessionDir) {
	const out = [];
	for (const directory of await readdir(sessionDir).catch(() => [])) {
		const entries = await readdir(join(sessionDir, directory)).catch(() => []);
		for (const entry of entries) out.push(join(directory, entry));
	}
	return out.sort();
}

async function withSessionDir(use) {
	const dir = await mkdtemp(join(tmpdir(), "harness-session-"));
	try {
		return await use(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("pi's session id rule is enforced", () => {
	assert.equal(resolveConfig(["--session-id", "ok.id_1-a"], {}, "/w").sessionError, undefined);
	assert.equal(resolveConfig(["--session-id", "7"], {}, "/w").sessionError, undefined);
	for (const bad of ["-bad", "bad-", ".lead", "trail.", "has space"]) {
		assert.notEqual(resolveConfig(["--session-id", bad], {}, "/w").sessionError, undefined, bad);
	}
});

test("the tenant defaults and can be named", () => {
	assert.equal(resolveConfig([], {}, "/w").tenant, "default");
	assert.equal(resolveConfig(["--tenant", "acme"], {}, "/w").tenant, "acme");
	assert.equal(resolveConfig([], {}, "/w").schema, "harness");
	assert.equal(resolveConfig([], { PI_DURABLE_PG_SCHEMA: "custom" }, "/w").schema, "custom");
});

test("two sessions in one directory are two containers", async () => {
	await withSessionDir(async (dir) => {
		const first = await rpc(["--session-id", "aaa"], dir);
		const second = await rpc(["--session-id", "bbb"], dir);
		assert.equal(first.response.data.sessionId, "aaa");
		assert.equal(second.response.data.sessionId, "bbb");
		const written = await files(dir);
		assert.equal(written.length, 2, written.join(", "));
		assert.ok(written.some((path) => path.endsWith("__aaa.sqlite")));
		assert.ok(written.some((path) => path.endsWith("__bbb.sqlite")));
	});
});

test("the name is not the identity", async () => {
	await withSessionDir(async (dir) => {
		await rpc(["--session-id", "keep", "--name", "first"], dir);
		const second = await rpc(["--session-id", "keep", "--name", "second"], dir);
		assert.equal(second.response.data.sessionId, "keep");
		assert.equal((await files(dir)).length, 1);
	});
});

test("no session flag mints a new uuid", async () => {
	await withSessionDir(async (dir) => {
		const { response } = await rpc([], dir);
		assert.match(response.data.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});
});

test("-c opens the newest session and not the oldest", async () => {
	await withSessionDir(async (dir) => {
		await rpc(["--session-id", "older"], dir);
		await rpc(["--session-id", "newer"], dir);
		const written = await files(dir);
		const olderPath = join(dir, written.find((path) => path.endsWith("__older.sqlite")));
		const newerPath = join(dir, written.find((path) => path.endsWith("__newer.sqlite")));
		await utimes(olderPath, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
		await utimes(newerPath, new Date("2030-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z"));
		const { response } = await rpc(["-c"], dir);
		assert.equal(response.data.sessionId, "newer");
	});
});

test("the tenant separates containers for one session id", async () => {
	await withSessionDir(async (dir) => {
		await rpc(["--session-id", "same", "--tenant", "acme"], dir);
		await rpc(["--session-id", "same", "--tenant", "other"], dir);
		const written = await files(dir);
		assert.equal(written.length, 2, written.join(", "));
	});
});

test("a malformed session id exits with a diagnostic", async () => {
	await withSessionDir(async (dir) => {
		const { response, code, stderr } = await rpc(["--session-id", "bad-"], dir);
		assert.equal(response, undefined);
		assert.equal(code, 1);
		assert.match(stderr, /invalid session id/);
		assert.deepEqual(await files(dir), []);
	});
});

test("a session file lives under its working directory", async () => {
	await withSessionDir(async (dir) => {
		await writeFile(join(dir, "keep"), "");
		await rpc(["--session-id", "placed"], dir);
		const written = await files(dir);
		assert.equal(written.length, 1);
		// `<cwd-slug>/<tenant>__<session>.sqlite`
		assert.match(written[0], /^[^/]+\/default_[0-9a-f]{8}__placed\.sqlite$/);
	});
});
