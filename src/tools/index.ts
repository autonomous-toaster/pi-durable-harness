/**
 * File tools ported onto durable's tool model (task 7.1): `ls`, `find`, and
 * `grep`, with the same parameter shapes pi uses. File and shell work goes
 * through the call's `ExecutionEnv`, so the tools run in the sandbox the
 * environment describes. `powershell` is added by durable on Windows.
 */
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type ToolExecutionApi } from "@earendil-works/pi-durable";
import { createPowerShellTool } from "@earendil-works/pi-durable/tools";
import { codemodeTool } from "./codemode.js";
import { toolSearchTool } from "./tool-search.js";

interface RunResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

async function run(api: ToolExecutionApi, argv: readonly string[], context: Context): Promise<RunResult> {
	const env = api.env;
	if (env === undefined) throw new Error("no execution environment is configured");
	let stdout = "";
	let stderr = "";
	const result = await env.exec(
		argv,
		{
			onOutput: (text, _context, info) => {
				if (info.stream === "stderr") stderr += text;
				else stdout += text;
			},
		},
		context,
	);
	if (!result.ok) throw new Error(result.error.message ?? String(result.error));
	return { stdout, stderr, exitCode: result.value.exitCode };
}

function text(value: string, isError = false) {
	return { content: [{ type: "text" as const, text: value }], ...(isError ? { isError: true } : {}) };
}

function limited(value: string, limit: number | undefined): string {
	if (limit === undefined || limit <= 0) return value;
	const lines = value.split("\n");
	if (lines.length <= limit) return value;
	return `${lines.slice(0, limit).join("\n")}\n[truncated ${lines.length - limit} lines]`;
}

export const lsTool = defineTool({
	name: "ls",
	description: "List directory contents",
	parameters: Type.Object({ path: Type.Optional(Type.String()), limit: Type.Optional(Type.Number()) }),
	execute: async (args, api, context) => {
		const result = await run(api, ["ls", "-a", args.path ?? "."], context);
		const body = result.exitCode === 0 ? result.stdout : result.stderr;
		return text(limited(body, args.limit), result.exitCode !== 0);
	},
});

export const findTool = defineTool({
	name: "find",
	description: "Find files by glob pattern",
	parameters: Type.Object({
		pattern: Type.String(),
		path: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Number()),
	}),
	execute: async (args, api, context) => {
		const result = await run(api, ["find", args.path ?? ".", "-name", args.pattern, "-type", "f"], context);
		const body = result.exitCode === 0 ? result.stdout : result.stderr;
		return text(limited(body, args.limit), result.exitCode !== 0);
	},
});

export const grepTool = defineTool({
	name: "grep",
	description: "Search file contents for patterns",
	parameters: Type.Object({
		pattern: Type.String(),
		path: Type.Optional(Type.String()),
		glob: Type.Optional(Type.String()),
		ignoreCase: Type.Optional(Type.Boolean()),
		literal: Type.Optional(Type.Boolean()),
		context: Type.Optional(Type.Number()),
		limit: Type.Optional(Type.Number()),
	}),
	execute: async (args, api, context) => {
		const argv = ["grep", "-rn"];
		if (args.ignoreCase === true) argv.push("-i");
		if (args.literal === true) argv.push("-F");
		if (args.context !== undefined) argv.push("-C", String(args.context));
		if (args.glob !== undefined) argv.push(`--include=${args.glob}`);
		argv.push(args.pattern, args.path ?? ".");
		const result = await run(api, argv, context);
		// Exit code 1 means "no matches", which is not an error for grep.
		const failed = result.exitCode !== 0 && result.exitCode !== 1;
		const body = result.exitCode === 1 ? "" : failed ? result.stderr : result.stdout;
		return text(limited(body, args.limit), failed);
	},
});

/** `ls`, `find`, and `grep`; the coding tools stay in their own extension. */
export const FileTools = defineExtension({ name: "harness.file-tools", tools: [lsTool, findTool, grepTool] });

/** `codemode` and `tool_search` (tasks 7.2, 7.3). */
export const CodemodeTools = defineExtension({ name: "harness.codemode", tools: [codemodeTool, toolSearchTool] });

/** The platform shell tool: durable's PowerShell tool on Windows, nothing elsewhere. */
export function platformShellTools(): ReturnType<typeof defineExtension> {
	return defineExtension({
		name: "harness.platform-shell",
		tools: process.platform === "win32" ? [createPowerShellTool()] : [],
	});
}
