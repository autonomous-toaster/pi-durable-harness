/**
 * Where a session lives and which one a launch opens (tasks 1.1-1.6, 2.1-2.4).
 *
 * The container is the session. The working directory and the tenant are data:
 * they name the container and, for PostgreSQL, a catalog row. Nothing about a
 * session's identity depends on the directory, so two directories with the same
 * name never collide and two sessions in one directory never share a writer.
 */
import { createHash, randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import type { HarnessConfig } from "./config.js";

/** The tenant a launch belongs to when none is named. */
export const DEFAULT_TENANT = "default";

/** The one PostgreSQL schema every session opens inside. */

/** Table holding one row per session, for the newest-use lookup. */
const CATALOG = "harness_sessions";

/**
 * pi's session-id rule: letters, digits, `.`, `_`, `-`, starting and ending
 * with a letter or a digit.
 */
export function isValidSessionId(id: string): boolean {
	return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id);
}

/** A fresh session id, as pi mints one. */
export function newSessionId(): string {
	return randomUUID();
}

/** Lowercase, filesystem- and identifier-safe slug with a digest for uniqueness. */
function slug(value: string): string {
	const ascii = value
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 24);
	const digest = createHash("sha256").update(value).digest("hex").slice(0, 8);
	return `${ascii === "" ? "x" : ascii}_${digest}`;
}

/** Directory name for one working directory under the session directory. */
export function cwdSlug(cwd: string): string {
	return slug(cwd);
}

/** File-name stem shared by both backends: `<tenant>__<session>`. */
export function sessionStem(tenant: string, sessionId: string): string {
	return `${slug(tenant)}__${sessionId}`;
}

/** PostgreSQL table prefix for one session; a valid SQLite identifier. */
export function sessionPrefix(tenant: string, sessionId: string): string {
	const digest = createHash("sha256").update(`${tenant}\u0000${sessionId}`).digest("hex").slice(0, 12);
	return `s_${digest}_`;
}

/** The SQLite file of one session, grouped under its working directory. */
export function sessionFile(config: HarnessConfig, sessionId: string): string {
	return join(config.sessionDir, cwdSlug(config.cwd), `${sessionStem(config.tenant, sessionId)}.sqlite`);
}

/** Create the catalog table once; it shares the schema with prefixed storage tables. */
async function ensureCatalog(client: pg.PoolClient, schema: string): Promise<void> {
	await client.query(
		`CREATE TABLE IF NOT EXISTS "${schema}".${CATALOG} (
			tenant TEXT NOT NULL,
			cwd TEXT NOT NULL,
			session TEXT NOT NULL,
			last_used BIGINT NOT NULL,
			PRIMARY KEY (tenant, cwd, session)
		)`,
	);
}

/** A short-lived pool over the configured database. */
async function withPool<T>(config: HarnessConfig, use: (client: pg.PoolClient) => Promise<T>): Promise<T | undefined> {
	if (config.databaseUrl === undefined) return undefined;
	const { poolOptions, assertEncrypted, connectionHint } = await import("../storage/postgres/ssl.js");
	const { connectionString, ssl, enforce } = poolOptions(config.databaseUrl, config.pgSsl);
	const pool = new pg.Pool({ connectionString, ...(ssl === undefined ? {} : { ssl }) });
	const client = await pool.connect().catch(async (error: unknown) => {
		// A swallowed connection error left the operator reading a bare driver message.
		const hint = connectionHint(connectionString, error);
		process.stderr.write(`pi-durable-harness: PostgreSQL connection failed: ${error instanceof Error ? error.message : String(error)}\n`);
		if (hint !== undefined) process.stderr.write(`pi-durable-harness: ${hint}\n`);
		await pool.end().catch(() => {});
		return undefined;
	});
	if (client === undefined) return undefined;
	try {
		if (enforce) await assertEncrypted(client);
		return await use(client);
	} finally {
		client.release();
		await pool.end().catch(() => {});
	}
}

/** Record that a session was used now (task 2.3). */
export async function stampSession(config: HarnessConfig, sessionId: string, at = Date.now()): Promise<void> {
	await withPool(config, async (client) => {
		await ensureCatalog(client, config.schema);
		await client.query(
			`INSERT INTO "${config.schema}".${CATALOG} (tenant, cwd, session, last_used)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (tenant, cwd, session) DO UPDATE SET last_used = EXCLUDED.last_used`,
			[config.tenant, config.cwd, sessionId, at],
		);
	});
}

/** The most recently used session for this tenant and directory (tasks 1.2, 2.3). */
async function newestInCatalog(config: HarnessConfig): Promise<string | undefined> {
	return await withPool(config, async (client) => {
		await ensureCatalog(client, config.schema);
		const result = await client.query<{ session: string }>(
			`SELECT session FROM "${config.schema}".${CATALOG}
			 WHERE tenant = $1 AND cwd = $2
			 ORDER BY last_used DESC LIMIT 1`,
			[config.tenant, config.cwd],
		);
		return result.rows[0]?.session;
	});
}

/** The most recently modified session file for this tenant in this directory (task 2.4). */
async function newestFile(config: HarnessConfig): Promise<string | undefined> {
	const directory = join(config.sessionDir, cwdSlug(config.cwd));
	const entries = await readdir(directory).catch(() => [] as string[]);
	const stem = `${slug(config.tenant)}__`;
	let newest: { session: string; mtime: number } | undefined;
	for (const entry of entries) {
		if (!entry.startsWith(stem) || !entry.endsWith(".sqlite")) continue;
		const session = entry.slice(stem.length, -".sqlite".length);
		const info = await stat(join(directory, entry)).catch(() => undefined);
		if (info === undefined) continue;
		if (newest === undefined || info.mtimeMs > newest.mtime) newest = { session, mtime: info.mtimeMs };
	}
	return newest?.session;
}

export interface ResolvedSession {
	readonly id: string;
	readonly warning?: string;
}

/**
 * Resolve the session a launch opens: the explicit id, the newest one for
 * `-c`, or a fresh one (tasks 1.1, 1.2).
 */
export async function resolveSession(config: HarnessConfig): Promise<ResolvedSession> {
	if (config.sessionKey !== undefined) return { id: config.sessionKey };
	if (!config.continueSession) return { id: newSessionId() };
	const latest = config.databaseUrl === undefined ? await newestFile(config) : await newestInCatalog(config);
	if (latest === undefined || latest === "") {
		return { id: newSessionId(), warning: `no session to continue for ${config.cwd}; starting a new one` };
	}
	return { id: latest };
}
