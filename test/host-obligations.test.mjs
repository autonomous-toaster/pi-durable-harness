/**
 * The host obligations the durable framework states (tasks 1.1, 1.2, 4.1, 4.2, 5.1).
 *
 * A failed session is reopened, a faulted task is reported, a run says why it ended, and a turn
 * does not spend a catalog stamp it does not need. The classification is pure, so the whole
 * vocabulary is asserted here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { classifyReport, adviceFor, unansweredReason, outcomeLine } = await import("../dist/harness/reports.js");

test("a storage failure is a session failure", () => {
	const report = classifyReport({ kind: "storage_failed", error: new Error("connection reset") });
	assert.equal(report.class, "session");
	assert.match(report.line, /reopening the session/);
});

test("a faulted task is a task failure, not a session one", () => {
	for (const kind of ["task_faulted", "task_interrupted", "task_error", "task_outdated", "migration_failed"]) {
		const report = classifyReport({ kind, error: new Error("boom"), reason: "restart_limit" });
		assert.equal(report.class, "task", kind);
		assert.match(report.line, /a task ended/, kind);
	}
});

test("everything else is a diagnostic", () => {
	for (const kind of ["extension_error", "host_error", "listener_error", "unknown"]) {
		assert.equal(classifyReport({ kind, error: "x" }).class, "diagnostic", kind);
	}
});

test("an unanswered run names its reason, and a done run has none", () => {
	assert.equal(unansweredReason({ status: "done" }), undefined);
	assert.equal(unansweredReason({ status: "unanswered", reason: "turn_limit" }), "turn_limit");
	assert.equal(unansweredReason({ status: "unanswered" }), "unanswered");
	// The vocabulary the framework documents, each with advice rather than a silent exit.
	for (const reason of ["model_error", "no_model", "restart_limit", "invalid_park", "turn_limit", "nothing_to_answer", "stale", "aborted"]) {
		assert.notEqual(adviceFor(reason), adviceFor("nonsense"), reason);
		assert.match(outcomeLine(reason), new RegExp(reason));
	}
	assert.match(adviceFor("nothing_to_answer"), /caller bug/);
});

const { installShutdown } = await import("../dist/harness/shutdown.js");

test("a signal closes once, then exits with the shell's code", async () => {
	const lines = [];
	let closes = 0;
	let code;
	const remove = installShutdown({
		close: async () => {
			closes += 1;
		},
		timeoutMs: 50,
		report: (line) => lines.push(line),
		exit: (status) => {
			code = status;
		},
	});
	process.emit("SIGTERM", "SIGTERM");
	process.emit("SIGTERM", "SIGTERM");
	await new Promise((resolve) => setTimeout(resolve, 100));
	remove();
	assert.equal(closes, 1, "a second signal does not close twice");
	assert.equal(code, 143, "SIGTERM exits as a shell reports it");
	assert.ok(lines.some((line) => /closed on SIGTERM/.test(line)), lines.join("\n"));
});

test("a wedged close is bounded and still exits", async () => {
	const lines = [];
	let code;
	const remove = installShutdown({
		close: () => new Promise(() => {}),
		timeoutMs: 30,
		report: (line) => lines.push(line),
		exit: (status) => {
			code = status;
		},
		signals: ["SIGINT"],
	});
	process.emit("SIGINT", "SIGINT");
	await new Promise((resolve) => setTimeout(resolve, 120));
	remove();
	assert.equal(code, 130);
	assert.ok(lines.some((line) => /did not finish within/.test(line)), lines.join("\n"));
});

test("a storage failure reopens the same session, keeping its identity and transcript", async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { resolveConfig } = await import("../dist/harness/config.js");
	const { HarnessEngine } = await import("../dist/harness/engine.js");
	const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");

	const dir = mkdtempSync(join(tmpdir(), "pi-reopen-"));
	const config = resolveConfig(["--session-dir", dir, "--session-id", "reopen-probe"], {}, dir, false);
	const modelRuntime = await ModelRuntime.create();
	const { SettingsManager } = await import("@earendil-works/pi-coding-agent");
	const engine = await HarnessEngine.open({
		config,
		key: "reopen-probe",
		modelRuntime,
		settingsManager: SettingsManager.create(dir, dir),
		resources: { skills: [], prompts: [], systemPrompt: undefined, appendSystemPrompt: [] },
	});
	const before = engine.conversationId;
	const lines = [];
	engine.setFailureReporter((line) => lines.push(line));

	// The framework's own vocabulary: a session failure is reopened by the host.
	engine.handleReport({ kind: "storage_failed", error: new Error("connection reset") });
	for (let attempt = 0; attempt < 100 && engine.recovering; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
	await new Promise((resolve) => setTimeout(resolve, 50));

	assert.equal(engine.recovering, false, "the reopen finished");
	assert.equal(engine.conversationId, before, "the same conversation is open again");
	assert.ok(lines.some((line) => /reopening the session/.test(line)), lines.join("\n"));
	assert.ok(lines.some((line) => /session reopened/.test(line)), lines.join("\n"));
	assert.deepEqual(await engine.entries(), [], "the transcript is readable after the reopen");
	await engine.close();
});

test("the CLI closes on SIGTERM and reports it", async () => {
	const { spawn } = await import("node:child_process");
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join, dirname } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const root = join(dirname(fileURLToPath(import.meta.url)), "..");
	const dir = mkdtempSync(join(tmpdir(), "pi-signal-"));
	const child = spawn(process.execPath, [join(root, "dist", "cli.js"), "--mode", "rpc", "--session-dir", dir, "--session-id", "signal-probe"], {
		cwd: root,
		env: { ...process.env, PI_OFFLINE: "1" },
	});
	let stderr = "";
	let stdout = "";
	let answered = false;
	child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
	child.stdout.on("data", (chunk) => {
		stdout += chunk.toString("utf8");
		if (stdout.includes('"get_state"')) answered = true;
	});
	child.stdin.write(`${JSON.stringify({ id: "boot", type: "get_state" })}\n`);
	// The session is up when it answers, so the signal lands on a live host rather than a boot.
	for (let attempt = 0; attempt < 200 && !answered; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
	assert.ok(answered, `the session never answered; stderr: ${stderr.slice(-300)}`);
	child.kill("SIGTERM");
	const code = await new Promise((resolve) => child.on("close", (status, signal) => resolve(status ?? signal)));
	assert.equal(code, 143, `exit was ${code}; stderr: ${stderr.slice(-300)}`);
	assert.match(stderr, /closed on SIGTERM/);
});

const { reopenDelayMs, shouldStamp, STAMP_INTERVAL_MS } = await import("../dist/harness/reports.js");

test("a failed reopen waits longer each time, bounded", () => {
	assert.equal(reopenDelayMs(1), 1_000);
	assert.equal(reopenDelayMs(2), 2_000);
	assert.equal(reopenDelayMs(3), 4_000);
	assert.equal(reopenDelayMs(20), 30_000);
	assert.equal(reopenDelayMs(0), 1_000);
});

test("a turn stamps the catalog once a minute, and always the first time", () => {
	assert.equal(shouldStamp({ now: 1_000, stampedAt: 0 }), true);
	assert.equal(shouldStamp({ now: 5_000, stampedAt: 1_000 }), false);
	assert.equal(shouldStamp({ now: 1_000 + STAMP_INTERVAL_MS, stampedAt: 1_000 }), true);
});

test("a prompt during a reopen is refused by name", async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { resolveConfig } = await import("../dist/harness/config.js");
	const { HarnessEngine, SessionRecoveringError } = await import("../dist/harness/engine.js");
	const { ModelRuntime, SettingsManager } = await import("@earendil-works/pi-coding-agent");

	const dir = mkdtempSync(join(tmpdir(), "pi-refuse-"));
	const config = resolveConfig(["--session-dir", dir, "--session-id", "refuse-probe"], {}, dir, false);
	const engine = await HarnessEngine.open({
		config,
		key: "refuse-probe",
		modelRuntime: await ModelRuntime.create(),
		settingsManager: SettingsManager.create(dir, dir),
		resources: { skills: [], prompts: [], systemPrompt: undefined, appendSystemPrompt: [] },
	});
	engine.setFailureReporter(() => {});
	// The reopen begins synchronously, so a prompt that arrives now meets the recovering state.
	engine.handleReport({ kind: "storage_failed", error: new Error("reset") });
	await assert.rejects(() => engine.submit("hello"), (error) => error instanceof SessionRecoveringError);
	for (let attempt = 0; attempt < 100 && engine.recovering; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
	await engine.close();
});

test("a one-shot run that did not answer exits non-zero and says why", async () => {
	const { runOneShot } = await import("../dist/harness/oneshot.js");
	const { Writable } = await import("node:stream");
	const out = new Writable({
		write(_chunk, _encoding, done) {
			done();
		},
	});
	const written = [];
	const original = process.stderr.write.bind(process.stderr);
	process.stderr.write = (chunk) => {
		written.push(String(chunk));
		return true;
	};
	try {
		const code = await runOneShot(
			"print",
			["do something"],
			{
				submitAndWait: async () => false,
				lastOutcome: () => ({ answered: false, reason: "nothing_to_answer" }),
				lastAssistantText: async () => undefined,
				watchEvents: async () => ({ value: undefined, start: () => {}, stop: async () => {} }),
				isQuiescent: async () => true,
				sessionId: "outcome",
				cwd: process.cwd(),
				out,
			},
			undefined,
		);
		assert.equal(code, 1, "an unanswered run fails the command");
	} finally {
		process.stderr.write = original;
	}
	assert.ok(written.some((line) => /nothing_to_answer/.test(line) && /caller bug/.test(line)), written.join(""));
});

const { withTimeout } = await import("../dist/harness/shutdown.js");

test("a close that hangs is bounded", async () => {
	const started = Date.now();
	const outcome = await withTimeout(new Promise(() => {}), 40);
	assert.equal(outcome, "timed-out");
	assert.ok(Date.now() - started < 500, "it did not wait for the hang");
	assert.equal(await withTimeout(Promise.resolve(), 40), "settled");
	assert.equal(await withTimeout(Promise.reject(new Error("x")).catch(() => undefined), 40), "settled");
});

test("an in-memory session refuses a reopen instead of starting empty", async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { resolveConfig } = await import("../dist/harness/config.js");
	const { HarnessEngine } = await import("../dist/harness/engine.js");
	const { ModelRuntime, SettingsManager } = await import("@earendil-works/pi-coding-agent");

	const dir = mkdtempSync(join(tmpdir(), "pi-memory-"));
	const config = resolveConfig(["--no-session"], {}, dir, false);
	const engine = await HarnessEngine.open({
		config,
		key: "memory-probe",
		modelRuntime: await ModelRuntime.create(),
		settingsManager: SettingsManager.create(dir, dir),
		resources: { skills: [], prompts: [], systemPrompt: undefined, appendSystemPrompt: [] },
	});
	const lines = [];
	engine.setFailureReporter((line) => lines.push(line));
	engine.handleReport({ kind: "storage_failed", error: new Error("gone") });
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.ok(lines.some((line) => /cannot be reopened/.test(line) && /in-memory/.test(line)), lines.join("\n"));
	assert.equal(engine.recovering, false);
	await engine.close();
});
