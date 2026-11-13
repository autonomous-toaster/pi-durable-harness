/**
 * TLS for the PostgreSQL backend: a mode, and the certificates that make the
 * verifying modes possible.
 *
 * The names are libpq's, behind our prefix: `PI_DURABLE_PGSSLMODE`,
 * `PI_DURABLE_PGSSLROOTCERT`, `PI_DURABLE_PGSSLCERT`, `PI_DURABLE_PGSSLKEY`. The bare
 * names are read as a fallback, through the same field order the connection uses.
 *
 * Two of libpq's modes are refused. `allow` and `prefer` both describe a plaintext
 * fallback, and this backend has none: a mode that promises to prove the peer must
 * fail rather than quietly encrypt less.
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
export function resolveSsl(options: {
	readonly url?: string | undefined;
	readonly env: Record<string, string | undefined>;
	/** Already resolved from the prefixed name, the URL, and the standard name. */
	readonly mode?: string | undefined;
	readonly rootCertificate?: string | undefined;
	readonly certificate?: string | undefined;
	readonly key?: string | undefined;
}): SslDecision {
	const requested = options.mode ?? sslModeFromUrl(options.url);
	// The two modes that need a plaintext fallback, which this backend does not have.
	if (requested === "allow" || requested === "prefer") {
		throw new SslConfigError(
			`PGSSLMODE=${requested} asks for a plaintext fallback, which this backend has none: use one of ${MODES.join(", ")}`,
		);
	}
	if (requested !== undefined && !(MODES as readonly string[]).includes(requested)) {
		throw new SslConfigError(`PI_DURABLE_PGSSLMODE must be one of ${MODES.join(", ")}`);
	}
	const mode = requested as SslMode | undefined;
	if (mode === undefined || mode === "disable") return { mode: mode ?? "disable", enforce: false };
	const caPath = options.rootCertificate;
	const verifies = mode === "verify-ca" || mode === "verify-full";
	if (verifies && (caPath === undefined || caPath === "")) {
		throw new SslConfigError(
			`${mode} needs a root certificate: set PI_DURABLE_PGSSLROOTCERT to the authority that signed the server's certificate`,
		);
	}
	const ca = caPath === undefined ? undefined : readPem(caPath, "PI_DURABLE_PGSSLROOTCERT");
	const certPath = options.certificate;
	const keyPath = options.key;
	if ((certPath === undefined) !== (keyPath === undefined)) {
		throw new SslConfigError("PI_DURABLE_PGSSLCERT and PI_DURABLE_PGSSLKEY must be set together");
	}
	return {
		mode,
		// `require` encrypts without proving the peer; the verification modes prove it.
		enforce: true,
		ssl: {
			...(ca === undefined ? {} : { ca }),
			...(certPath === undefined ? {} : { cert: readPem(certPath, "PI_DURABLE_PGSSLCERT") }),
			...(keyPath === undefined ? {} : { key: readPem(keyPath, "PI_DURABLE_PGSSLKEY") }),
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
		`${host} resolves the tenant from the user name only: use postgres.<project-ref>.`,
		"PI_DURABLE_PG_SSL_SERVERNAME does not help here; measured against this pooler,",
		"a server name alone is still answered with ENOIDENTIFIER.",
	].join(" ");
}

/**
 * The tenant a pooler will ask for, when the URL does not name one. Supavisor's
 * shared pooler resolves it from `postgres.<project-ref>`; measured against it, a
 * TLS server name alone is still answered with ENOIDENTIFIER, so only the user
 * name is offered as the fix. Said before connecting, since the pooler's own
 * answer names neither the cause nor the remedy.
 */
export function missingTenant(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		const isPooler = /\.pooler\./.test(parsed.hostname);
		if (!isPooler) return undefined;
		const user = decodeURIComponent(parsed.username);
		if (user.includes(".")) return undefined;
		return `the pooler at ${parsed.hostname} needs a tenant in the user name: postgres.<project-ref> (a TLS server name alone is not enough)`;
	} catch {
		return undefined;
	}
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
		throw new SslConfigError("The database connection is not encrypted (enforced by PI_DURABLE_PGSSLMODE)");
	}
}
