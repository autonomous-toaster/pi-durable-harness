import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every event pi's TUI handles is either announced by the adapter or listed as an
// accepted gap with a reason. A new event in pi, or one dropped here, fails this.
test("every UI event pi handles is announced or an accepted gap", () => {
	const output = execFileSync(process.execPath, [join(root, "tools", "tui-gaps.mjs"), "--check"], {
		cwd: root,
		encoding: "utf8",
	});
	assert.match(output, /0 unexplained/, output.split("\n").filter((line) => line.includes("NOT ACCOUNTED")).join("\n"));
});
