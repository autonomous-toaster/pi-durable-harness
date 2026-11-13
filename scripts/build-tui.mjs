#!/usr/bin/env node
// The TUI build (task 2.1).
//
// Unlike the other artifacts this one is not single-file: pi-tui resolves its
// native module from its own package (`native/<platform>/prebuilds/...`), from
// its dist, or beside the executing binary. A TUI therefore runs from an
// installed package tree. This script builds `dist/` and proves the helper for
// this platform resolves, so a broken install fails here rather than at startup.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });
if (build.status !== 0) process.exit(build.status ?? 1);

const platform = process.platform;
const arch = process.arch;
if (arch !== "x64" && arch !== "arm64") {
	process.stderr.write(`pi-durable: pi-tui has no native helper for ${platform}/${arch}\n`);
	process.exit(1);
}
const path = `native/${platform}/prebuilds/${platform}-${arch}/${platform}-platform.node`;
try {
	const helper = require(`@earendil-works/pi-tui/${path}`);
	if (typeof helper?.getText !== "function") throw new Error("helper does not look like the terminal helper");
} catch (error) {
	process.stderr.write(
		`pi-durable: cannot load ${path} (${error instanceof Error ? error.message : String(error)}).\n` +
			"The TUI needs the installed @earendil-works/pi-tui package tree; it is not a single-file artifact.\n",
	);
	process.exit(1);
}
// The compiled artifact: one executable, the TUI included, with the helper beside it.
// Shared Node builds (Homebrew's among them) cannot produce one, so that case is named
// instead of being reported as a build failure.
const sea = spawnSync(process.execPath, ["scripts/build-sea.mjs"], { stdio: "inherit" });
if (sea.status !== 0) {
	process.stderr.write(
		"pi-durable: dist/ is ready, but this Node cannot build the executable.\n" +
			"  npx -y node@22.19.0 scripts/build-tui.mjs\n" +
			"  (official Node builds can; shared ones, such as Homebrew's, cannot.)\n",
	);
	process.exit(sea.status ?? 1);
}
process.stdout.write(`TUI build ready: dist/ plus ${path}\n`);
