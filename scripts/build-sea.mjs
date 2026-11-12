#!/usr/bin/env node
// Node SEA build: one executable from the same sources as the ESM bundle.
//
// SEA runs its main script as CommonJS, so this produces a CJS bundle, asks the
// current Node to make the blob, injects it into a copy of that Node, and signs
// the result on macOS. Run it with a SEA-capable Node: official builds are, while
// shared builds such as Homebrew's answer "Single executable application is
// disabled". `npx -y node@22.19.0 scripts/build-sea.mjs` is one way.
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "dist", "sea");
const main = join(out, "cli.cjs");
const blob = join(out, "sea.blob");
const binary = join(out, "pi-durable-harness");
const darwin = process.platform === "darwin";

const run = (command, args, options = {}) => {
	const result = spawnSync(command, args, { stdio: "inherit", ...options });
	return result.status ?? 1;
};

await mkdir(out, { recursive: true });

// pi's exports map hides the codemode description composer, so the source names
// it and the bundler resolves it here, exactly as the ESM bundle does.
const codemodeTool = join(root, "node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js");
await build({
	entryPoints: [join(root, "src/cli.ts")],
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	outfile: main,
	alias: { "@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js": codemodeTool },
	// SEA's main is CommonJS and has no module URL, but pi's composer computes one
	// at load. Define it so the module initialises; nothing in a SEA reads it.
	define: { "import.meta.url": JSON.stringify(pathToFileURL(codemodeTool).href) },
	// The codemode sandbox needs the QuickJS wasm; a SEA blob carries no
	// node_modules, so the bundle inlines it.
	loader: { ".wasm": "binary" },
	logLevel: "warning",
});
process.stdout.write(`bundled ${main}\n`);

const config = join(out, "sea-config.json");
await writeFile(
	config,
	`${JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true }, null, "\t")}\n`,
);
const prepared = spawnSync(process.execPath, ["--experimental-sea-config", config], { encoding: "utf8" });
if (`${prepared.stderr}${prepared.stdout}`.includes("Single executable application is disabled")) {
	process.stderr.write(
		`pi-durable-harness: this Node cannot build a SEA binary (${process.execPath}).\n` +
			"Shared builds, such as Homebrew's, disable it. Use an official Node build, for example\n" +
			"  npx -y node@22.19.0 scripts/build-sea.mjs\n",
	);
	process.exit(1);
}
if (prepared.status !== 0) {
	process.stderr.write(prepared.stderr || "sea preparation failed\n");
	process.exit(1);
}

await copyFile(process.execPath, binary);
await chmod(binary, 0o755);
if (darwin) run("codesign", ["--remove-signature", binary]);
const postject = join(root, "node_modules", ".bin", process.platform === "win32" ? "postject.cmd" : "postject");
run(postject, [
	binary,
	"NODE_SEA_BLOB",
	blob,
	"--sentinel-fuse",
	"NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
	...(darwin ? ["--macho-segment-name", "NODE_SEA"] : []),
]);
if (darwin) run("codesign", ["--sign", "-", binary]);
process.stdout.write(`built ${binary}\n`);
const size = (await readFile(binary)).length;
process.stdout.write(`${Math.round(size / 1024 / 1024)} MiB\n`);
