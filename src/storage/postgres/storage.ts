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
import type { Layout } from "./layout.js";

export class SessionLockedError extends Error {
	constructor(schema: string) {
		super(`Session is already open in another process: ${schema}`);
		this.name = "SessionLockedError";
	}
}

export interface PostgresStorageOptions {
	readonly pool: Pool;
	/** The one schema every session opens inside. */
	readonly schema: string;
	/** Table prefix of one session inside that schema. */
	readonly prefix: string;
	/** `shared` keeps one table set for every session; `prefixed` gives each its own. */
	readonly layout?: Layout;
	/**
	 * Continue even though another process holds the session. The lock exists only
	 * while its holder is connected, so this steals a *live* session on purpose.
	 */
	readonly takeOver?: boolean;
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
	const layout = options.layout ?? "shared";
	const database = await PostgresDatabase.open(options.pool, options.schema, { prefix: options.prefix, layout });
	try {
		if (!(await database.tryAdvisoryLock(advisoryKey(`${options.schema}\u0000${options.prefix}`)))) {
			if (options.takeOver !== true) throw new SessionLockedError(`${options.schema}/${options.prefix}`);
			process.stderr.write(
				`pi-durable-harness: another process holds ${options.schema}/${options.prefix}; continuing without the lock, its writes will fail\n`,
			);
		}
		// The prefix keeps each session's table set apart inside the shared schema.
		return await SqliteStorage.open(database, { prefix: options.prefix });
	} catch (error) {
		await database.close().catch(() => {});
		throw error;
	}
}
