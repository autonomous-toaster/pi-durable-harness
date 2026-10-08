#!/usr/bin/env node
// Release build (task 1.5).
//
// `--bundle` produces a single JavaScript file at dist/bundle/cli.js from the
// ESM entry. Node built-ins stay external (platform: node).
//
// A true single-executable (Node SEA) additionally requires embedding assets
// (the QuickJS wasm the codemode worker loads) and injecting the blob into the
// node binary with `postject`, which this project does not depend on. So the
// supported release artifact is the ESM package (`npm run build`); the bundle
// is provided for constrained images that already run Node, and the fallback is
// documented here rather than silently shipping a broken executable.
import { build } from "esbuild";
import { chmod, readFile, writeFile } from "node:fs/promises";

await build({
	entryPoints: ["src/cli.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	outfile: "dist/bundle/cli.js",
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
