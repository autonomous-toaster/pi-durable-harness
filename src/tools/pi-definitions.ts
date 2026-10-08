/**
 * pi's tool definitions, extracted verbatim (task 5.5, 5.6). The built-in
 * schemas are presentation only: execution stays durable's. `codemode`'s
 * description is the base text; the declarations are appended at runtime.
 */
export interface PiToolDefinition {
	readonly description: string;
	readonly parameters: unknown;
	readonly snippet: string;
	readonly guidelines: readonly string[];
}

export const PI_TOOL_DEFINITIONS: Readonly<Record<string, PiToolDefinition>> = {
	read: {
		description:
			"Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
		parameters: {
			type: "object",
			required: ["path"],
			properties: {
				path: { type: "string", description: "Path to the file to read (relative or absolute)" },
				offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
				limit: { type: "number", description: "Maximum number of lines to read" },
			},
		},
		snippet: "Read file contents",
		guidelines: ["Use read to examine files instead of cat or sed."],
	},
	bash: {
		description:
			"Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.",
		parameters: {
			type: "object",
			required: ["command"],
			properties: {
				command: { type: "string", description: "Shell command to execute" },
				timeout: { type: "number", description: "Timeout in seconds (optional, no default timeout)" },
			},
		},
		snippet: "Execute bash commands (ls, grep, find, etc.)",
		guidelines: ["You can inspect PI_* environment variables for current model and session details."],
	},
	edit: {
		description:
			"Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
		parameters: {
			type: "object",
			required: ["path", "edits"],
			properties: {
				path: { type: "string", description: "Path to the file to edit (relative or absolute)" },
				edits: {
					type: "array",
					items: {
						type: "object",
						required: ["oldText", "newText"],
						properties: {
							oldText: {
								type: "string",
								description:
									"Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
							},
							newText: { type: "string", description: "Replacement text for this targeted edit." },
						},
					},
					description:
						"One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
				},
			},
		},
		snippet: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
		guidelines: [
			"Use edit for precise changes (edits[].oldText must match exactly)",
			"When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
			"Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
			"Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
		],
	},
	write: {
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: {
			type: "object",
			required: ["path", "content"],
			properties: {
				path: { type: "string", description: "Path to the file to write (relative or absolute)" },
				content: { type: "string", description: "Content to write to the file" },
			},
		},
		snippet: "Create or overwrite files",
		guidelines: ["Use write only for new files or complete rewrites."],
	},
};

/** pi's `Codemode:` output type per tool; tools without one resolve to `a string`. */
export const CODEMODE_OUTPUT_TYPES: Readonly<Record<string, string>> = {
	read: '`string | { data: string; mimeType: string; note: string; type: "image"; }`',
	bash: "`{ output, truncated, full_output_path?, exit_code, wall_time_seconds }`",
};

/** pi's output schema per built-in tool, used by the codemode description composer. */
export const PI_TOOL_OUTPUT_SCHEMAS: Readonly<Record<string, unknown>> = {
	read: {
		anyOf: [
			{ type: "string" },
			{
				type: "object",
				required: ["type", "data", "mimeType", "note"],
				properties: {
					type: { type: "string", const: "image" },
					data: { type: "string" },
					mimeType: { type: "string" },
					note: { type: "string" },
				},
			},
		],
	},
	bash: {
		type: "object",
		required: ["output", "truncated", "exit_code", "wall_time_seconds"],
		properties: {
			output: { type: "string", description: "Combined stdout and stderr, possibly truncated" },
			truncated: { type: "boolean" },
			full_output_path: { type: "string", description: "Full output, when truncated" },
			exit_code: { type: "number" },
			wall_time_seconds: { type: "number" },
		},
	},
};

/** pi's codemode base description (the declarations are appended at runtime). */
export const CODEMODE_DESCRIPTION =
	"Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level `await` and `return` work. No Node, file system, network, or timers.\n- `await tools.<name>({ ...args })` resolves to a string, or an object if the tool's declaration says so, and rejects with an Error on failure. Calls still running when the script ends are cancelled.\n- Optional first line: `// @options: {\"max_output_tokens\": 10000, \"timeout_ms\": 60000}`\n\nGlobals:\n- `text(value)`, `image(dataUrlOrImageBlock)`, `console.log(...)`, and top-level `return` add output; `exit()` ends the script. With several text items, each starts with a `==> text N/M <==` line, and `console` lines follow the other output in one `<console_output>` block. `image()` also saves the image to a temp file and the result names its path.\n- `store(key, value)` and `load(key)` keep JSON values across codemode calls.\n- `ALL_TOOLS`, `await searchTools(query, { limit?, namespace? })`, `await describeTool(name)`, `await describeNamespace(name)`: find unlisted tools, such as MCP tools.";

export const CODEMODE_PARAMETERS = {
	type: "object",
	required: ["code"],
	properties: { code: { type: "string", description: "Raw JavaScript source." } },
};

export const CODEMODE_CONTRIBUTION = {
	snippet: "Run JavaScript that calls other tools",
	guidelines: [
		"Use codemode to batch independent tool calls (Promise.allSettled), chain them, or filter large output, instead of many separate calls.",
	],
};

/** pi's tool_search description and schema. */
export const TOOL_SEARCH_DESCRIPTION =
	"# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.\n\nSome of the tools, such as tools of MCP servers, may not have been provided to you upfront, and you should use this tool (`tool_search`) to search for the required tools. For MCP tool discovery, always use `tool_search`.";

export const TOOL_SEARCH_PARAMETERS = {
	type: "object",
	required: ["query"],
	properties: {
		query: { type: "string", description: "Search query for deferred tools." },
		limit: { type: "number", description: "Maximum number of tools to return. Defaults to 8." },
	},
};

export const TOOL_SEARCH_CONTRIBUTION = {
	snippet: "Search for tools that are not loaded yet and load the matches",
	guidelines: [],
};
