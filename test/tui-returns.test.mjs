import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// navigateTree returned nothing and pi read `.aborted` off it; /export returned HTML
// where pi expects a path. Both were members that existed and answered the wrong shape,
// so the check calls every member and compares against what pi consumes.
test("no consumed member answers undefined without a stated reason", () => {
	const output = execFileSync(process.execPath, [join(root, "tools", "tui-returns.mjs"), "--check"], {
		cwd: root,
		encoding: "utf8",
	});
	assert.match(output, /0 suspect/, output.split("\n").filter((line) => line.startsWith("SUSPECT")).join("\n"));
});
