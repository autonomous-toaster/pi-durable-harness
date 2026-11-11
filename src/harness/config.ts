/**
 * Startup contract: the harness is configured through pi's CLI flags and
 * environment variables only (design D8, task 3.4). Flags the harness does not
 * act on are ignored, so a client can pass pi's full argument list unchanged;
 * only a value-less flag whose value is missing is reported on stderr.
 */
import { existsSync, readFileSync } from "node:fs";
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
	/** How long a deferred progress commit may stay in memory; `0` stores it at once. */
	readonly persistWithinMs: number;
	readonly offline: boolean;
	readonly help: boolean;
	readonly warnings: readonly string[];
}

/** Flags pi 1.5.2 parses with a value but the harness does not act on. */
const IGNORED_VALUE_FLAGS: ReadonlySet<string> = new Set([
	"--api-key",
	"--export",
	"--fork",
	"--models",
	"--prompt-template",
	"--skill",
	"--theme",
]);

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

const VALUE_FLAGS: Readonly<Record<string, keyof HarnessConfig | "mode">> = {
	"--mode": "mode",
	"--session-id": "sessionKey",
	"--session": "sessionKey",
	"--session-dir": "sessionDir",
	"--provider": "provider",
	"--model": "model",
	"--thinking": "thinking",
	"--name": "name",
	"-n": "name",
};

export function resolveConfig(
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
	cwd: string = process.cwd(),
): HarnessConfig {
	const agentDir = expandTilde(env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
	const warnings: string[] = [];
	const values: Record<string, string> = {};
	const flags = new Set<string>();
	const prompts: string[] = [];
	let optionsEnded = false;

	let systemPrompt: string | undefined;
	const appendSystemPrompt: string[] = [];

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]!;
		if (!optionsEnded && argument === "--") {
			optionsEnded = true;
			continue;
		}
		if (!optionsEnded && argument.startsWith("-")) {
			// pi consumes the next token unconditionally for these, and
			// `--append-system-prompt` is repeatable.
			if (argument === "--system-prompt" || argument === "--append-system-prompt") {
				const value = argv[index + 1];
				if (value === undefined) {
					warnings.push(`missing value for ${argument}`);
					continue;
				}
				if (argument === "--system-prompt") systemPrompt = resolveTextOrFile(value);
				else appendSystemPrompt.push(resolveTextOrFile(value));
				index += 1;
				continue;
			}
			if (IGNORED_VALUE_FLAGS.has(argument)) {
				if (argv[index + 1] !== undefined) index += 1;
				continue;
			}
			const target = VALUE_FLAGS[argument];
			if (target !== undefined) {
				const value = argv[index + 1];
				if (value === undefined || value.startsWith("-")) {
					warnings.push(`missing value for ${argument}`);
					continue;
				}
				values[target] = value;
				index += 1;
				continue;
			}
			flags.add(argument);
			continue;
		}
		prompts.push(argument);
	}

	const mode = values.mode;
	if (mode !== undefined && mode !== "rpc" && mode !== "json" && mode !== "text") warnings.push(`unsupported --mode ${mode}`);
	if (prompts.length > 0 && mode === "rpc") warnings.push("RPC mode takes prompts through the prompt command, not as arguments");
	if (flags.has("--help") || flags.has("-h")) warnings.length = 0;

	// `--session` may name a path or an id; both are treated as the session key.
	const sessionKey = values.sessionKey ?? values.name;
	const ephemeral = flags.has("--no-session");

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
	const interfaceName: HarnessConfig["interfaceName"] =
		mode === "rpc" ? "rpc" : prompts.length === 0 ? "rpc" : mode === "json" ? "json" : "print";

	return {
		mode,
		interfaceName,
		prompts,
		print: flags.has("--print") || flags.has("-p"),
		cwd,
		agentDir,
		sessionDir: expandTilde(values.sessionDir ?? env.PI_CODING_AGENT_SESSION_DIR ?? join(agentDir, "sessions")),
		sessionKey,
		continueSession: flags.has("--continue") || flags.has("-c"),
		ephemeral,
		provider: values.provider,
		model: values.model,
		thinking: values.thinking,
		name: values.name,
		databaseUrl: env.PI_DURABLE_DATABASE_URL,
		systemPrompt,
		appendSystemPrompt,
		persistWithinMs,
		offline: flags.has("--offline") || env.PI_OFFLINE === "1",
		help: flags.has("--help") || flags.has("-h"),
		warnings,
	};
}
