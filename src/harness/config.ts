/**
 * Startup contract: the harness is configured through pi's CLI flags and
 * environment variables only (design D8, task 3.4). Flags the harness does not
 * act on are ignored, so a client can pass pi's full argument list unchanged;
 * only a value-less flag whose value is missing is reported on stderr.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** Expand a leading `~` the way pi's config resolver does. */
function expandTilde(path: string): string {
	return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

export interface HarnessConfig {
	readonly mode: "rpc";
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
	readonly offline: boolean;
	readonly help: boolean;
	readonly warnings: readonly string[];
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

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]!;
		if (!argument.startsWith("-")) continue;
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
	}

	const mode = values.mode ?? "rpc";
	if (mode !== "rpc") warnings.push(`unsupported --mode ${mode}; the harness serves rpc only`);
	if (flags.has("--help") || flags.has("-h")) warnings.length = 0;

	// `--session` may name a path or an id; both are treated as the session key.
	const sessionKey = values.sessionKey ?? values.name;
	const ephemeral = flags.has("--no-session");

	return {
		mode: "rpc",
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
		offline: flags.has("--offline") || env.PI_OFFLINE === "1",
		help: flags.has("--help") || flags.has("-h"),
		warnings,
	};
}
