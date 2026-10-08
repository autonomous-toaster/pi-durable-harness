/**
 * Open Pi Durable's `Storage` on PostgreSQL. The portable `SqliteStorage` core
 * (and its migrations) runs over the PostgreSQL facade, so commit, scan, and
 * document behavior matches the built-in SQLite backend; the session-level
 * advisory lock adds the cross-process single writer.
 */
import type { Pool } from "pg";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { PostgresDatabase } from "./database.js";

export class SessionLockedError extends Error {
	constructor(schema: string) {
		super(`Session is already open in another process: ${schema}`);
		this.name = "SessionLockedError";
	}
}

export interface PostgresStorageOptions {
	readonly pool: Pool;
	/** One schema per session (design D10). */
	readonly schema: string;
}

/** Signed 64-bit advisory-lock key for a schema name (FNV-1a). */
export function advisoryKey(schema: string): bigint {
	const prime = 0x100000001b3n;
	const mask = (1n << 64n) - 1n;
	let hash = 0xcbf29ce484222325n;
	for (let index = 0; index < schema.length; index++) {
		hash = ((hash ^ BigInt(schema.charCodeAt(index))) * prime) & mask;
	}
	return hash >= 1n << 63n ? hash - (1n << 64n) : hash;
}

export async function openPostgresStorage(options: PostgresStorageOptions): Promise<SqliteStorage> {
	const database = await PostgresDatabase.open(options.pool, options.schema);
	try {
		if (!(await database.tryAdvisoryLock(advisoryKey(options.schema)))) {
			throw new SessionLockedError(options.schema);
		}
		// SqliteStorage.open runs the portable migrations on this database.
		return await SqliteStorage.open(database);
	} catch (error) {
		await database.close().catch(() => {});
		throw error;
	}
}
