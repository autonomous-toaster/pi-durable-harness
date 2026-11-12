/**
 * TLS for the PostgreSQL backend, driven by the URL and by environment variables.
 *
 * `sslmode` in the URL is honoured (`disable`, `require`, `verify-ca`,
 * `verify-full`); `PI_DURABLE_PG_SSL` overrides it, and a CA given with
 * `PI_DURABLE_PG_SSL_CA` is what makes verification possible. Enforced TLS means a
 * connection that turns out not to be encrypted is refused rather than silently
 * used, which the URL alone cannot promise: a server may accept `sslmode=prefer`
 * and answer in clear text.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SslMode = "disable" | "require" | "verify-ca" | "verify-full";

export interface SslDecision {
	/** What `pg` is given; undefined leaves the driver's own default (no TLS). */
	readonly ssl?: { readonly ca?: string; readonly cert?: string; readonly key?: string; readonly rejectUnauthorized: boolean; readonly servername?: string };
	/** Whether a connection must prove it is encrypted before it is used. */
	readonly enforce: boolean;
	readonly mode: SslMode;
}

export class SslConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SslConfigError";
	}
}

const MODES: readonly SslMode[] = ["disable", "require", "verify-ca", "verify-full"];

/** `~` expands to the home directory, as the rest of the harness does. */
function expand(path: string): string {
	return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function readPem(path: string, variable: string): string {
	try {
		return readFileSync(expand(path), "utf8");
	} catch (error) {
		throw new SslConfigError(`${variable}: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** The `sslmode` a URL carries, if any. */
export function sslModeFromUrl(url: string | undefined): SslMode | undefined {
	if (url === undefined) return undefined;
	const query = url.indexOf("?");
	if (query === -1) return undefined;
	const parameter = new URLSearchParams(url.slice(query + 1)).get("sslmode");
	return parameter !== null && (MODES as readonly string[]).includes(parameter) ? (parameter as SslMode) : undefined;
}

/**
 * Decide what to hand `pg` and whether to insist on TLS. A verification mode needs
 * a CA; `disable` alongside an enforcing request is refused rather than ignored.
 */
export function resolveSsl(options: { readonly url?: string; readonly env: Record<string, string | undefined> }): SslDecision {
	const explicit = options.env.PI_DURABLE_PG_SSL;
	if (explicit !== undefined && !(MODES as readonly string[]).includes(explicit)) {
		throw new SslConfigError(`PI_DURABLE_PG_SSL must be one of ${MODES.join(", ")}`);
	}
	const mode = (explicit as SslMode | undefined) ?? sslModeFromUrl(options.url);
	const enforceRequested = options.env.PI_DURABLE_PG_REQUIRE_SSL === "1" || options.env.PI_DURABLE_PG_REQUIRE_SSL === "true";
	if (mode === "disable") {
		if (enforceRequested) throw new SslConfigError("PI_DURABLE_PG_REQUIRE_SSL is set but the SSL mode is disable");
		return { mode, enforce: false };
	}
	if (mode === undefined) {
		// Nothing asked for TLS, but the operator may still insist on it.
		if (enforceRequested) throw new SslConfigError("PI_DURABLE_PG_REQUIRE_SSL is set but no SSL mode is configured");
		return { mode: "disable", enforce: false };
	}
	const caPath = options.env.PI_DURABLE_PG_SSL_CA;
	const verifies = mode === "verify-ca" || mode === "verify-full";
	if (verifies && caPath === undefined) {
		throw new SslConfigError(`${mode} needs a CA: set PI_DURABLE_PG_SSL_CA to the server certificate's authority`);
	}
	const ca = caPath === undefined ? undefined : readPem(caPath, "PI_DURABLE_PG_SSL_CA");
	const certPath = options.env.PI_DURABLE_PG_SSL_CERT;
	const keyPath = options.env.PI_DURABLE_PG_SSL_KEY;
	if ((certPath === undefined) !== (keyPath === undefined)) {
		throw new SslConfigError("PI_DURABLE_PG_SSL_CERT and PI_DURABLE_PG_SSL_KEY must be set together");
	}
	return {
		mode,
		// `require` encrypts without proving the peer; the verification modes prove it.
		enforce: true,
		ssl: {
			...(ca === undefined ? {} : { ca }),
			...(certPath === undefined ? {} : { cert: readPem(certPath, "PI_DURABLE_PG_SSL_CERT") }),
			...(keyPath === undefined ? {} : { key: readPem(keyPath, "PI_DURABLE_PG_SSL_KEY") }),
			rejectUnauthorized: verifies,
			...(options.env.PI_DURABLE_PG_SSL_SERVERNAME === undefined
				? {}
				: { servername: options.env.PI_DURABLE_PG_SSL_SERVERNAME }),
		},
	};
}

/** The hostname a URL names, or undefined when it is an IP or unparsable. */
export function hostnameOf(url: string): string | undefined {
	try {
		const host = new URL(url).hostname;
		// An IP cannot be a TLS server name, so it must not be sent as one.
		return host === "" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") ? undefined : host;
	} catch {
		return undefined;
	}
}

/**
 * A hint for a connection that failed for a reason the operator can fix. Supavisor,
 * the Supabase pooler, resolves the tenant from the username's `.<ref>` suffix or
 * from the TLS server name; without either it answers ENOIDENTIFIER, which says
 * nothing about what to change.
 */
export function connectionHint(url: string, error: unknown): string | undefined {
	const message = error instanceof Error ? error.message : String(error);
	if (!/ENOIDENTIFIER|no tenant identifier|sni_hostname/i.test(message)) return undefined;
	const host = hostnameOf(url) ?? "the pooler host";
	return [
		`${host} is a pooler that identifies the tenant from the username or the TLS server name.`,
		"Use the project-scoped user (postgres.<project-ref>) in the URL, or set",
		`PI_DURABLE_PG_SSL_SERVERNAME=db.<project-ref>.supabase.co so the name is sent.`,
	].join(" ");
}

/**
 * The tenant a pooler will ask for, when the URL does not name one. Supavisor's
 * shared pooler needs `postgres.<project-ref>`; a bare `postgres` user and no
 * server name is answered with ENOIDENTIFIER after a round trip, so it is worth
 * saying before the connection is attempted.
 */
export function missingTenant(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		const isPooler = /\.pooler\./.test(parsed.hostname);
		if (!isPooler) return undefined;
		const user = decodeURIComponent(parsed.username);
		if (user.includes(".")) return undefined;
		return `the pooler at ${parsed.hostname} needs a tenant: use postgres.<project-ref> as the user, or set PI_DURABLE_PG_SSL_SERVERNAME=db.<project-ref>.supabase.co`;
	} catch {
		return undefined;
	}
}

/** The pool options for a database URL under an environment, with TLS applied. */
export function poolOptions(
	url: string,
	env: Record<string, string | undefined> = process.env,
): { readonly connectionString: string; readonly ssl?: SslDecision["ssl"]; readonly enforce: boolean } {
	const decision = resolveSsl({ url, env });
	// A pooler that identifies its tenant from SNI needs the name sent, and node only
	// sends it when `ssl` is an object it can read a servername from.
	const servername = decision.ssl?.servername ?? (decision.ssl === undefined ? undefined : hostnameOf(url));
	return {
		connectionString: url,
		...(decision.ssl === undefined ? {} : { ssl: { ...decision.ssl, ...(servername === undefined ? {} : { servername }) } }),
		enforce: decision.enforce,
	};
}

/**
 * Refuse a connection that is not encrypted. `pg_stat_ssl` reports what the server
 * actually negotiated, so this catches a server that accepted the handshake
 * parameter and then served clear text.
 */
export async function assertEncrypted(executor: { query(sql: string): Promise<{ rows: unknown[] }> }): Promise<void> {
	const result = await executor.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
	const row = result.rows[0] as { readonly ssl?: boolean } | undefined;
	if (row?.ssl !== true) {
		throw new SslConfigError("The database connection is not encrypted (enforced by PI_DURABLE_PG_SSL)");
	}
}
