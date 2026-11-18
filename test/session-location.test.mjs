/**
 * The session location (tasks 4.1-4.3).
 *
 * pi's info panel prints `File: <path>` or "In-memory" when there is no file, and the
 * RPC status carries the same value. A durable session is stored either as a file or in
 * PostgreSQL, so one function decides what to report and both surfaces read that answer.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cliEnv } from "./support-cli.mjs";

const { sessionLocation } = await import("../dist/harness/session.js");

async function config(overrides = {}) {
	return {
		cwd: "/work/project",
		sessionDir: await mkdtemp(join(tmpdir(), "pi-durable-location-")),
		tenant: "default",
		schema: "durable",
		ephemeral: false,
		pg: undefined,
		...overrides,
	};
}

test("a local session reports its file path", async () => {
	const local = await config();
	const location = sessionLocation(local, "abc-123");
	// The stem carries the tenant and a hash of the working directory, as the file name does.
	assert.match(location, /default_[0-9a-f]{8}__abc-123\.sqlite$/, location);
	assert.ok(location.startsWith(local.sessionDir), location);
});

test("a PostgreSQL session reports its storage identity", async () => {
	const remote = await config({ pg: { host: "db.example.com" }, schema: "durable", tenant: "tenant-a" });
	assert.equal(sessionLocation(remote, "abc-123"), "postgres:durable/tenant-a__abc-123");
});

test("an ephemeral session reports no location", async () => {
	const ephemeral = await config({ ephemeral: true });
	assert.equal(sessionLocation(ephemeral, "abc-123"), undefined);
	assert.equal(sessionLocation({ ...ephemeral, pg: { host: "db.example.com" } }, "abc-123"), undefined);
});

test("the RPC status reports the same string the panel prints", async () => {
	const { execFile } = await import("node:child_process");
	const { dirname } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const root = join(dirname(fileURLToPath(import.meta.url)), "..");
	const sessionDir = await mkdtemp(join(tmpdir(), "pi-durable-rpc-location-"));

	const records = await new Promise((resolve, reject) => {
		const child = execFile(
			process.execPath,
			[join(root, "dist", "cli.js"), "--mode", "rpc", "--session-dir", sessionDir, "--session-id", "located"],
			{ cwd: root, env: cliEnv() },
		);
		const seen = [];
		let buffer = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`timeout; stderr: ${stderr.slice(-300)}`));
		}, 25_000);
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			let at;
			while ((at = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
				if (line.trim().length === 0) continue;
				seen.push(JSON.parse(line));
			}
			if (seen.some((record) => record.type === "response" && record.id === "r1")) child.stdin.end();
		});
		child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
		child.on("close", () => {
			clearTimeout(timer);
			resolve(seen);
		});
		child.stdin.write(`${JSON.stringify({ id: "r1", type: "get_state" })}\n`);
	});

	const response = records.find((record) => record.type === "response" && record.id === "r1");
	assert.ok(response, "a get_state response arrived");
	// The server resolves the directory from its own working directory, so the value is
	// compared against the same call made with that directory.
	const expected = sessionLocation(await config({ sessionDir, cwd: root }), "located");
	assert.equal(response.data.sessionFile, expected);
	assert.notEqual(response.data.sessionFile, null);
});

test("an ephemeral session reports no location over RPC", async () => {
	const { execFile } = await import("node:child_process");
	const { dirname } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const root = join(dirname(fileURLToPath(import.meta.url)), "..");
	const records = await new Promise((resolve, reject) => {
		const child = execFile(process.execPath, [join(root, "dist", "cli.js"), "--mode", "rpc", "--no-session"], {
			cwd: root,
			env: cliEnv(),
		});
		const seen = [];
		let buffer = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("timeout"));
		}, 25_000);
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			let at;
			while ((at = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
				if (line.trim().length === 0) continue;
				seen.push(JSON.parse(line));
			}
			if (seen.some((record) => record.type === "response" && record.id === "r2")) child.stdin.end();
		});
		child.on("close", () => {
			clearTimeout(timer);
			resolve(seen);
		});
		child.stdin.write(`${JSON.stringify({ id: "r2", type: "get_state" })}\n`);
	});
	const response = records.find((record) => record.type === "response" && record.id === "r2");
	assert.ok(response, "a get_state response arrived");
	assert.equal(response.data.sessionFile, null);
});
