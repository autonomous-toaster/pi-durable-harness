/**
 * Open Pi Durable's `Storage` on PostgreSQL. The portable `SqliteStorage` core
 * (and its migrations) runs over the PostgreSQL facade, so commit, scan, and
 * document behavior matches the built-in SQLite backend. Every session opens in
 * one schema under its own table prefix, and the advisory lock keys on both, so
 * two sessions in one schema run in parallel while a second writer of the same
 * session is refused.
 */
import type { Pool } from "pg";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { PostgresDatabase } from "./database.js";

/**
 * Another process writes this session. The message names the session, which is what
 * a user passed to `--session-id` and what `/session` shows; the table prefix the
 * backend derives from it is an implementation detail and is kept out.
 */
export class SessionLockedError extends Error {
	constructor(
		readonly session: string,
		readonly schema: string,
	) {
		super(`session ${session} is open in another process (schema ${schema})`);
		this.name = "SessionLockedError";
	}
}

export interface PostgresStorageOptions {
	readonly pool: Pool;
	/** The one schema every session opens inside. */
	readonly schema: string;
	/** Table prefix of one session inside that schema. */
	readonly prefix: string;
	/** The session as the user names it, for messages. */
	readonly session?: string;
}

/** Signed 64-bit advisory-lock key for a schema and session prefix (FNV-1a). */
export function advisoryKey(name: string): bigint {
	const prime = 0x100000001b3n;
	const mask = (1n << 64n) - 1n;
	let hash = 0xcbf29ce484222325n;
	for (let index = 0; index < name.length; index++) {
		hash = ((hash ^ BigInt(name.charCodeAt(index))) * prime) & mask;
	}
	return hash >= 1n << 63n ? hash - (1n << 64n) : hash;
}

export async function openPostgresStorage(options: PostgresStorageOptions): Promise<SqliteStorage> {
	const database = await PostgresDatabase.open(options.pool, options.schema, { prefix: options.prefix });
	try {
		if (!(await database.tryAdvisoryLock(advisoryKey(`${options.schema}\u0000${options.prefix}`)))) {
			throw new SessionLockedError(options.session ?? options.prefix, options.schema);
		}
		const storage = await SqliteStorage.open(database, { prefix: options.prefix });
		// The migrations create and rebuild tables; the references go on once they are done.
		await database.applyReferences();
		return storage;
	} catch (error) {
		await database.close().catch(() => {});
		throw error;
	}
}
