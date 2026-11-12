/**
 * `--skill` and `--prompt-template` load explicit resources (tasks: pi's
 * resource flags). Each is repeatable and reaches `get_commands`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolveConfig } from "../dist/harness/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Ask the harness for its command names. */
function commands(args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(root, "dist", "cli.js"), "--mode", "rpc", "--no-session", ...args], {
			cwd: root,
			env: { ...process.env, PI_OFFLINE: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let buffer = "";
		const names = [];
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("timeout"));
		}, 20_000);
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			let at;
			while ((at = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
				if (line.length === 0) continue;
				const record = JSON.parse(line);
				if (record.type === "response" && record.command === "get_commands") {
					for (const command of record.data.commands) names.push(command.name);
				}
			}
		});
		child.on("close", () => {
			clearTimeout(timer);
			resolve(names);
		});
		child.stdin.write(`${JSON.stringify({ id: "c1", type: "get_commands" })}\n`);
		setTimeout(() => child.stdin.end(), 1500);
	});
}

test("the resource flags are repeatable", () => {
	const config = resolveConfig(
		["--skill", "/a", "--skill", "/b", "--prompt-template", "/c", "--prompt-template", "/d"],
		{},
		"/w",
	);
	assert.deepEqual(config.skillPaths, ["/a", "/b"]);
	assert.deepEqual(config.promptTemplatePaths, ["/c", "/d"]);
	assert.deepEqual(config.prompts, [], "their values are not prompts");
});

test("--skill and --prompt-template reach get_commands", async () => {
	const dir = await mkdtemp(join(tmpdir(), "harness-resources-"));
	try {
		const skillDir = join(dir, "zz-resource-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			"---\nname: zz-resource-skill\ndescription: A probe skill\n---\nDo the probe.\n",
		);
		const template = join(dir, "zz-resource-template.md");
		await writeFile(template, "---\ndescription: A probe template\n---\nHello $1\n");

		const withFlags = await commands(["--skill", dir, "--prompt-template", template]);
		assert.ok(withFlags.includes("skill:zz-resource-skill"), `saw ${withFlags.join(",")}`);
		assert.ok(withFlags.includes("zz-resource-template"), `saw ${withFlags.join(",")}`);

		const without = await commands([]);
		assert.ok(!without.includes("skill:zz-resource-skill"));
		assert.ok(!without.includes("zz-resource-template"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
