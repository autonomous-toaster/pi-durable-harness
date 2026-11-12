#!/usr/bin/env node
// Release build (task 1.5).
//
// `--bundle` produces one self-contained JavaScript file at dist/bundle/cli.js
// from the ESM entry: Node built-ins stay external (platform: node), every
// package is inlined, and the file runs with no `node_modules` beside it.
//
// A Node SEA binary is a separate, unshipped step. SEA is native to Node
// (`--build-sea`), and pi-codemode takes an injected `wasm` module and `worker`
// entry for compiled executables; what is missing is a SEA-enabled Node build
// to package with and the wiring of `sea.getRawAsset` into those two options.
// The bundle below is the artifact to feed it once that exists.
import { build } from "esbuild";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// pi's exports map hides the codemode description composer, so the source names
// it and the bundler resolves it here. Without this the deep import stays
// external and the bundle only runs inside the repository (see pi-internals.ts).
const codemodeTool = fileURLToPath(
	new URL("../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js", import.meta.url),
);

await build({
	entryPoints: ["src/cli.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	outfile: "dist/bundle/cli.js",
	alias: { "@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js": codemodeTool },
	// The codemode sandbox needs the QuickJS wasm; inline it so the single file
	// carries it, rather than resolving `quickjs-wasi` from a missing node_modules.
	loader: { ".wasm": "binary" },
	logLevel: "info",
});
// esbuild's banner is not reliably the first line in ESM output, so prepend the
// shebang explicitly to keep the file directly executable.
const path = "dist/bundle/cli.js";
const bundled = await readFile(path, "utf8");
const body = bundled.replace(/^#![^\n]*\n/, "").replace(/^\s+/, "");
// Bundled CommonJS dependencies (cross-spawn, jiti) call `require`; ESM has no
// `require`, so define one from this module before the bundle body runs.
const shim = "import { createRequire as __hCreateRequire } from 'node:module';\nconst require = __hCreateRequire(import.meta.url);\n";
await writeFile(path, `#!/usr/bin/env node\n${shim}${body}`);
await chmod(path, 0o755);
process.stdout.write("bundled dist/bundle/cli.js\n");
