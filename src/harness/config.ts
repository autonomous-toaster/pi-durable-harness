/**
 * Startup contract: the harness is configured through pi's CLI flags and
 * environment variables only (design D8, task 3.4). Flags the harness does not
 * act on are ignored, so a client can pass pi's full argument list unchanged;
 * only a value-less flag whose value is missing is reported on stderr.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";

/** Expand a leading `~` the way pi's config resolver does. */
function expandTilde(path: string): string {
	return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

export interface HarnessConfig {
	readonly mode: string | undefined;
	readonly interfaceName: "rpc" | "print" | "json";
	readonly prompts: readonly string[];
	readonly print: boolean;
	readonly cwd: string;
	readonly agentDir: string;
	readonly sessionDir: string;
	readonly sessionKey: string | undefined;
	readonly continueSession: boolean;
	/** `--tenant`: labels the session; the tenant is data, not a namespace. */
	readonly tenant: string;
	/** The one PostgreSQL schema every session opens inside. */
	readonly schema: string;
	/** Set when the session id breaks pi's rule; the launch must not continue. */
	readonly sessionError: string | undefined;
	readonly ephemeral: boolean;
	readonly provider: string | undefined;
	readonly model: string | undefined;
	readonly thinking: string | undefined;
	readonly name: string | undefined;
	readonly databaseUrl: string | undefined;
	/** `--system-prompt`: replaces the built-in preamble. */
	readonly systemPrompt: string | undefined;
	/** `--append-system-prompt`: each occurrence, in argv order, after text-or-file resolution. */
	readonly appendSystemPrompt: readonly string[];
	/** `--skill`: extra skill files or directories, repeatable. */
	readonly skillPaths: readonly string[];
	/** `--prompt-template`: extra template files or directories, repeatable. */
	readonly promptTemplatePaths: readonly string[];
	/** `--models`: comma-separated scope patterns for startup and cycling. */
	readonly modelPatterns: readonly string[];
	/** `--api-key`: a non-persistent key for the selected provider. */
	readonly apiKey: string | undefined;
	/** `--fork`: the session id to copy into this directory's new session. */
	readonly forkFrom: string | undefined;
	/** How long a deferred progress commit may stay in memory; `0` stores it at once. */
	readonly persistWithinMs: number;
	readonly offline: boolean;
	readonly help: boolean;
	readonly warnings: readonly string[];
}

/**
 * Every option the harness understands, declared once. Flags pi parses with a
 * value that the harness does not act on are `string` here too, so their value
 * is consumed instead of leaking into the prompts.
 */
const OPTIONS = {
	// acted on
	mode: { type: "string" },
	"session-id": { type: "string" },
	session: { type: "string" },
	"session-dir": { type: "string" },
	provider: { type: "string" },
	model: { type: "string" },
	thinking: { type: "string" },
	tenant: { type: "string" },
	name: { type: "string", short: "n" },
	"system-prompt": { type: "string" },
	"append-system-prompt": { type: "string", multiple: true },
	continue: { type: "boolean", short: "c" },
	"no-session": { type: "boolean" },
	print: { type: "boolean", short: "p" },
	offline: { type: "boolean" },
	help: { type: "boolean", short: "h" },
	// accepted for pi compatibility, consumed and ignored
	skill: { type: "string", multiple: true },
	"prompt-template": { type: "string", multiple: true },
	models: { type: "string" },
	"api-key": { type: "string" },
	fork: { type: "string" },
	// still accepted and ignored
	export: { type: "string" },
	theme: { type: "string" },
} as const;

type Parsed = {
	readonly values: Readonly<Record<string, string | boolean | readonly string[] | undefined>>;
	readonly positionals: readonly string[];
};

/**
 * `parseArgs` throws when a known string option ends the line with no value;
 * that is the one case the harness reports as a warning and drops, so the rest
 * of the line still applies.
 */
function parse(argv: readonly string[], warnings: string[]): Parsed {
	const args: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]!;
		const name = argument.startsWith("--") && !argument.includes("=") ? argument.slice(2) : undefined;
		if (name !== undefined && name in OPTIONS && OPTIONS[name as keyof typeof OPTIONS].type === "string") {
			if (argv[index + 1] === undefined) {
				warnings.push(`missing value for ${argument}`);
				continue;
			}
		}
		args.push(argument);
	}
	return parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: false }) as Parsed;
}

/**
 * A `--system-prompt` value is text or the path of an existing file (pi's
 * `<text|path>`); resolution is by existence, so a literal string that looks
 * like a filename stays usable.
 */
function resolveTextOrFile(value: string): string {
	try {
		if (value.length > 0 && existsSync(value)) return readFileSync(value, "utf8");
	} catch {
		// An unreadable path falls back to the literal text, as pi does.
	}
	return value;
}

export function resolveConfig(
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
	cwd: string = process.cwd(),
): HarnessConfig {
	const agentDir = expandTilde(env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
	const warnings: string[] = [];
	const parsed = parse(argv, warnings);
	const values = parsed.values;
	const flag = (name: string): boolean => values[name] === true;
	const text = (name: string): string | undefined => (typeof values[name] === "string" ? (values[name] as string) : undefined);
	const prompts = [...parsed.positionals];

	const systemPromptRaw = text("system-prompt");
	const systemPrompt = systemPromptRaw === undefined ? undefined : resolveTextOrFile(systemPromptRaw);
	const appendRaw = values["append-system-prompt"];
	const appendSystemPrompt = (Array.isArray(appendRaw) ? appendRaw : []).map((value) => resolveTextOrFile(String(value)));
	const list = (name: string): string[] => {
		const value = values[name];
		return Array.isArray(value) ? value.map((item) => String(item)) : [];
	};

	const mode = text("mode");
	if (mode !== undefined && mode !== "rpc" && mode !== "json" && mode !== "text") warnings.push(`unsupported --mode ${mode}`);
	if (prompts.length > 0 && mode === "rpc") warnings.push("RPC mode takes prompts through the prompt command, not as arguments");
	if (flag("help")) warnings.length = 0;

	// `--session` may name a path or an id; both are treated as the session key.
	// The name is a display name; identity comes only from the session flags (task 1.4).
	// `--session-id` wins when both are given; the name is never identity (task 1.4).
	const sessionKey = text("session-id") ?? text("session");
	const ephemeral = flag("no-session");
	const forkFrom = text("fork");
	if (forkFrom !== undefined && (flag("continue") || text("session") !== undefined)) {
		warnings.push("--fork ignores --continue and --session; it copies into --session-id or a new session");
	}
	const tenant = text("tenant") ?? "default";
	const schema = env.PI_DURABLE_PG_SCHEMA ?? "harness";
	const sessionError =
		sessionKey !== undefined && !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(sessionKey)
			? `invalid session id ${JSON.stringify(sessionKey)}: use letters, numbers, ".", "_" and "-", starting and ending with a letter or number`
			: undefined;

	// Deferred-progress window (task 6.1). An invalid value warns and falls back to 0.
	let persistWithinMs = 0;
	const rawPersist = env.PI_DURABLE_PERSIST_WITHIN_MS;
	if (rawPersist !== undefined) {
		const parsed = Number(rawPersist);
		if (rawPersist.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
			warnings.push(`invalid PI_DURABLE_PERSIST_WITHIN_MS: ${rawPersist}`);
		} else {
			persistWithinMs = parsed;
		}
	}
	// An explicit RPC mode never yields to a positional argument: a stray token
	// is a warning, not a mode switch. This keeps an unknown value-taking flag
	// from silently turning the server into a one-shot print.
	const printMode = flag("print");
	const interfaceName: HarnessConfig["interfaceName"] =
		mode === "rpc"
			? "rpc"
			: printMode
				? "print"
				: prompts.length === 0
					? "rpc"
					: mode === "json"
						? "json"
						: "print";

	return {
		mode,
		interfaceName,
		prompts,
		print: printMode,
		cwd,
		agentDir,
		sessionDir: expandTilde(text("session-dir") ?? env.PI_CODING_AGENT_SESSION_DIR ?? join(agentDir, "sessions")),
		sessionKey,
		continueSession: flag("continue"),
		tenant,
		schema,
		sessionError,
		ephemeral,
		provider: text("provider"),
		model: text("model"),
		thinking: text("thinking"),
		name: text("name"),
		databaseUrl: env.PI_DURABLE_DATABASE_URL,
		systemPrompt,
		appendSystemPrompt,
		skillPaths: list("skill"),
		promptTemplatePaths: list("prompt-template"),
		modelPatterns: (text("models") ?? "")
			.split(",")
			.map((pattern) => pattern.trim())
			.filter((pattern) => pattern.length > 0),
		apiKey: text("api-key"),
		forkFrom,
		persistWithinMs,
		offline: flag("offline") || env.PI_OFFLINE === "1",
		help: flag("help"),
		warnings,
	};
}
