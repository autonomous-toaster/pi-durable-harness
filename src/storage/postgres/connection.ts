/**
 * The connection the PostgreSQL backend opens, resolved from four sources in one
 * order: a prefixed setting, the URL, the standard libpq name, then a default.
 *
 * The prefixed name carries the standard name unchanged (`PI_DURABLE_PGPASSWORD` for
 * `PGPASSWORD`), so the mapping is computed rather than listed, and one loop in the
 * tests covers every field. The bare name stays readable because one shell may serve
 * both `psql` and this harness.
 *
 * Only a prefixed setting selects PostgreSQL. A bare `PGHOST` is ambient — it may have
 * been exported for another tool months ago — so it fills a field and never decides
 * the backend.
 */
import { type SslDecision, hostnameOf, resolveSsl } from "./ssl.js";

/** The standard libpq names this backend reads, unchanged behind the prefix. */
export const STANDARD_NAMES = [
	"PGHOST",
	"PGPORT",
	"PGUSER",
	"PGPASSWORD",
	"PGDATABASE",
	"PGSSLMODE",
	"PGSSLROOTCERT",
	"PGSSLCERT",
	"PGSSLKEY",
	"PGOPTIONS",
	"PGAPPNAME",
	"PGCONNECT_TIMEOUT",
] as const;

export type StandardName = (typeof STANDARD_NAMES)[number];

/** The prefixed spelling: `PI_DURABLE_` plus the standard name, nothing else. */
export function prefixedName(name: string): string {
	return `PI_DURABLE_${name}`;
}

/** One value, taken from the first source that has it. */
export function resolveField(
	name: string,
	options: {
		readonly env: Record<string, string | undefined>;
		readonly urlValue?: string | undefined;
		readonly fallback?: string | undefined;
	},
): string | undefined {
	const prefixed = options.env[prefixedName(name)];
	if (prefixed !== undefined && prefixed !== "") return prefixed;
	if (options.urlValue !== undefined && options.urlValue !== "") return options.urlValue;
	const standard = options.env[name];
	if (standard !== undefined && standard !== "") return standard;
	return options.fallback;
}

/** The fields of a URL, empty when it cannot be parsed. */
function urlParts(url: string | undefined): {
	host?: string;
	port?: string;
	user?: string;
	password?: string;
	database?: string;
	sslMode?: string;
} {
	if (url === undefined) return {};
	try {
		const parsed = new URL(url);
		const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
		return {
			...(parsed.hostname === "" ? {} : { host: parsed.hostname }),
			...(parsed.port === "" ? {} : { port: parsed.port }),
			...(parsed.username === "" ? {} : { user: decodeURIComponent(parsed.username) }),
			...(parsed.password === "" ? {} : { password: decodeURIComponent(parsed.password) }),
			...(database === "" ? {} : { database }),
			...(parsed.searchParams.get("sslmode") === null ? {} : { sslMode: parsed.searchParams.get("sslmode") as string }),
		};
	} catch {
		return {};
	}
}

/** Whether a prefixed setting asks for PostgreSQL, so a bare name cannot. */
export function selectsPostgres(env: Record<string, string | undefined>): boolean {
	const url = env.PI_DURABLE_DATABASE_URL;
	const host = env[prefixedName("PGHOST")];
	const explicit = env.PI_DURABLE_PG;
	return (url !== undefined && url !== "") || (host !== undefined && host !== "") || explicit === "1" || explicit === "true";
}

/** A connection resolved to plain fields, and the TLS decision it implies. */
export interface PgConnection {
	readonly host: string | undefined;
	readonly port: number | undefined;
	readonly user: string | undefined;
	readonly password: string | undefined;
	readonly database: string | undefined;
	/** The inherited connection options, before the per-session scope is appended. */
	readonly options: string | undefined;
	readonly applicationName: string | undefined;
	readonly connectTimeoutMs: number | undefined;
	readonly ssl: SslDecision;
	/** The URL the operator gave, when there was one; hints and errors quote it. */
	readonly url: string | undefined;
}

/** Resolve the connection from the environment and the URL. */
export function resolveConnection(options: {
	readonly url: string | undefined;
	readonly env: Record<string, string | undefined>;
}): PgConnection {
	const env = options.env;
	const parts = urlParts(options.url);
	const field = (name: StandardName, urlValue: string | undefined): string | undefined =>
		resolveField(name, { env, urlValue });

	const portText = field("PGPORT", parts.port);
	const port = portText === undefined ? undefined : Number.parseInt(portText, 10);
	if (portText !== undefined && (!Number.isInteger(port) || (port as number) <= 0)) {
		throw new Error(`${prefixedName("PGPORT")}: ${portText} is not a port number`);
	}
	const timeoutText = field("PGCONNECT_TIMEOUT", undefined);
	const timeout = timeoutText === undefined ? undefined : Number.parseInt(timeoutText, 10);
	if (timeoutText !== undefined && (!Number.isInteger(timeout) || (timeout as number) < 0)) {
		throw new Error(`${prefixedName("PGCONNECT_TIMEOUT")}: ${timeoutText} is not a number of seconds`);
	}

	return {
		host: field("PGHOST", parts.host),
		port: port === undefined || Number.isNaN(port) ? undefined : port,
		user: field("PGUSER", parts.user),
		password: field("PGPASSWORD", parts.password),
		database: field("PGDATABASE", parts.database),
		options: field("PGOPTIONS", undefined),
		applicationName: field("PGAPPNAME", undefined),
		connectTimeoutMs: timeout === undefined || Number.isNaN(timeout) ? undefined : timeout * 1000,
		ssl: resolveSsl({
			url: options.url,
			env,
			mode: field("PGSSLMODE", parts.sslMode),
			rootCertificate: field("PGSSLROOTCERT", undefined),
			certificate: field("PGSSLCERT", undefined),
			key: field("PGSSLKEY", undefined),
		}),
		url: options.url,
	};
}

/**
 * What `pg` is given for one pool. The session scope is appended last, so a caller
 * cannot replace the setting the isolation policy reads.
 */
export function connectionOptions(
	connection: PgConnection,
	scope?: string,
): Record<string, unknown> {
	const options = [connection.options, scope].filter((part): part is string => part !== undefined && part !== "").join(" ");
	const defined = (value: unknown): boolean => value !== undefined && value !== null && value !== "";
	return {
		...(defined(connection.host) ? { host: connection.host } : {}),
		...(defined(connection.port) ? { port: connection.port } : {}),
		...(defined(connection.user) ? { user: connection.user } : {}),
		...(defined(connection.password) ? { password: connection.password } : {}),
		...(defined(connection.database) ? { database: connection.database } : {}),
		...(defined(connection.applicationName) ? { application_name: connection.applicationName } : {}),
		...(defined(connection.connectTimeoutMs) ? { connectionTimeoutMillis: connection.connectTimeoutMs } : {}),
		...(options === "" ? {} : { options }),
		...(connection.ssl.ssl === undefined ? {} : { ssl: withServerName(connection) }),
	};
}

/** A pooler that identifies its tenant from SNI needs the name sent. */
function withServerName(connection: PgConnection): SslDecision["ssl"] {
	const ssl = connection.ssl.ssl;
	if (ssl === undefined) return undefined;
	if (ssl.servername !== undefined) return ssl;
	const host = connection.host === undefined ? undefined : hostnameOf(`postgres://${connection.host}/`);
	return host === undefined ? ssl : { ...ssl, servername: host };
}

/** A URL-shaped description for hints, when the operator supplied only fields. */
export function describeConnection(connection: PgConnection): string {
	if (connection.url !== undefined) return connection.url;
	const user = connection.user === undefined ? "" : `${connection.user}@`;
	const port = connection.port === undefined ? "" : `:${connection.port}`;
	return `postgres://${user}${connection.host ?? ""}${port}/${connection.database ?? ""}`;
}
