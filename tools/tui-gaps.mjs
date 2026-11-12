#!/usr/bin/env node
/**
 * The UI gaps between pi's TUI and this harness, read from both.
 *
 * pi's InteractiveMode handles a fixed set of session events and renders tools
 * through renderers it gets from a definition or a built-in table. Both are
 * extracted from pi's dist and compared with what the adapter announces and
 * supplies. Gaps the host cannot close yet are listed with a reason, so the list
 * is a decision rather than an oversight. `--check` exits non-zero on an unlisted gap.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pi = (path) => join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", path);

/** Accepted gaps: real differences with a reason they are not closed yet. */
const ACCEPTED = new Map([
	["bash_execution_update", "executeBash streams through the TUI callback instead"],
	["summarization_retry_scheduled", "branch summarization is durable's task, not the session's"],
	["summarization_retry_attempt_start", "branch summarization is durable's task, not the session's"],
	["summarization_retry_finished", "branch summarization is durable's task, not the session's"],
]);

const interactive = readFileSync(pi("modes/interactive/interactive-mode.js"), "utf8");
/** The body of `handleEvent`, by brace matching, so other switches are not counted. */
function methodBody(text, signature) {
	const start = text.indexOf(signature);
	const open = text.indexOf("{", start);
	let depth = 0;
	for (let index = open; index < text.length; index++) {
		if (text[index] === "{") depth++;
		else if (text[index] === "}" && --depth === 0) return text.slice(open, index);
	}
	return text.slice(open);
}

const handleEvent = methodBody(interactive, "async handleEvent(event)");

// Event types pi's handler names, excluding the message roles it switches on.
const ROLES = new Set(["assistant", "user", "system", "custom", "text", "toolResult"]);
const handled = new Set(
	[...handleEvent.matchAll(/case "([a-z_]+)":/g)].map((match) => match[1]).filter((name) => !ROLES.has(name)),
);

const adapter = readFileSync(join(root, "src", "harness", "tui", "adapter.ts"), "utf8");
const announced = new Set([...adapter.matchAll(/type: "([a-z_]+)"/g)].map((match) => match[1]));

const missing = [...handled].filter((event) => !announced.has(event)).sort();
const unexplained = missing.filter((event) => !ACCEPTED.has(event));

// Tools pi can draw: a built-in renderer table, plus the renderers each tool ships.
const renderers = readFileSync(pi("core/tools/renderers/index.js"), "utf8");
const builtIn = [...renderers.matchAll(/^\s{8}(\w+): /gm)].map((match) => match[1]);
const fromExtensions = ["codemode"];

process.stdout.write(`events pi handles: ${handled.size}, announced: ${[...handled].filter((e) => announced.has(e)).length}\n`);
for (const event of missing) {
	process.stdout.write(`  gap  ${event.padEnd(34)} ${ACCEPTED.get(event) ?? "NOT ACCOUNTED FOR"}\n`);
}
process.stdout.write(`\ntools with a built-in renderer: ${builtIn.join(", ")}\n`);
process.stdout.write(`tools whose renderer ships with an extension: ${fromExtensions.join(", ")}\n`);
process.stdout.write(`  supplied through getToolDefinition: ${fromExtensions.filter((name) => adapter.includes("builtinRenderers")).join(", ") || "none"}\n`);
process.stdout.write(`\n${handled.size - missing.length}/${handled.size} events announced, ${missing.length} listed gaps, ${unexplained.length} unexplained\n`);

if (process.argv.includes("--check") && unexplained.length > 0) process.exitCode = 1;
