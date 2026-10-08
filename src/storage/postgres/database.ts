/**
 * PostgreSQL facade implementing Pi Durable's portable `SqliteDatabase`
 * interface, so the package's `SqliteStorage` core (and its migrations) runs
 * unchanged (tasks 2.1-2.4, 2.6).
 *
 * Reads return SQLite-shaped values: `int8` as a JS number and `json`/`jsonb`
 * as the raw string, because the core parses JSON itself. Every operation is
 * serialized on one connection, so a transaction excludes other operations
 * exactly as the interface requires.
 */
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite";
import { translateStatement } from "./ddl.js";

let typesConfigured = false;

function configureTypes(): void {
	if (typesConfigured) return;
	typesConfigured = true;
	pg.types.setTypeParser(20, (value) => Number(value));
	pg.types.setTypeParser(114, (value) => value);
	pg.types.setTypeParser(3802, (value) => value);
}

export function quoteIdent(name: string): string {
	if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid identifier: ${name}`);
	return `"${name}"`;
}

function normalize(value: SqliteValue): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}

async function query(
	client: PoolClient,
	sql: string,
	params: readonly SqliteValue[],
): Promise<{ rows: Record<string, unknown>[] }> {
	return client.query(translateStatement(sql), params.map(normalize));
}

/** Executor bound to one connection; used both directly and inside a transaction. */
class PostgresExecutor implements SqliteExecutor {
	constructor(private readonly client: PoolClient) {}

	async exec(sql: string): Promise<void> {
		await this.client.query(translateStatement(sql));
	}

	async run(sql: string, ...params: SqliteValue[]): Promise<void> {
		await query(this.client, sql, params);
	}

	async get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
		return (await query(this.client, sql, params)).rows[0] as T | undefined;
	}

	async all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
		return (await query(this.client, sql, params)).rows as T[];
	}
}

export class PostgresDatabase implements SqliteDatabase {
	readonly #client: PoolClient;
	#tail: Promise<unknown> = Promise.resolve();
	#closed = false;

	private constructor(client: PoolClient) {
		configureTypes();
		this.#client = client;
	}

	/** Acquire one connection, create the session schema, and target it. */
	static async open(pool: Pool, schema: string): Promise<PostgresDatabase> {
		const client = await pool.connect();
		try {
			await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
			await client.query(`SET search_path TO ${quoteIdent(schema)}`);
		} catch (error) {
			client.release();
			throw error;
		}
		return new PostgresDatabase(client);
	}

	#enqueue<T>(operation: () => Promise<T>): Promise<T> {
		if (this.#closed) return Promise.reject(new Error("PostgresDatabase is closed"));
		const next = this.#tail.then(operation, operation);
		this.#tail = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	/** Take the session-level advisory lock that enforces a single writer (task 2.5). */
	tryAdvisoryLock(key: bigint): Promise<boolean> {
		return this.#enqueue(async () => {
			const result = await this.#client.query<{ locked: boolean }>(
				"SELECT pg_try_advisory_lock($1::bigint) AS locked",
				[key.toString()],
			);
			return result.rows[0]?.locked === true;
		});
	}

	/** Drop the session schema and everything in it. Used by tests; not part of Storage. */
	dropSchema(schema: string): Promise<void> {
		return this.#enqueue(async () => {
			await this.#client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
		});
	}

	exec(sql: string): Promise<void> {
		return this.#enqueue(() => new PostgresExecutor(this.#client).exec(sql));
	}

	run(sql: string, ...params: SqliteValue[]): Promise<void> {
		return this.#enqueue(() => new PostgresExecutor(this.#client).run(sql, ...params));
	}

	get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
		return this.#enqueue(() => new PostgresExecutor(this.#client).get<T>(sql, ...params));
	}

	all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
		return this.#enqueue(() => new PostgresExecutor(this.#client).all<T>(sql, ...params));
	}

	transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
		return this.#enqueue(async () => {
			await this.#client.query("BEGIN");
			try {
				const result = await callback(new PostgresExecutor(this.#client));
				await this.#client.query("COMMIT");
				return result;
			} catch (error) {
				try {
					await this.#client.query("ROLLBACK");
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], "transaction rollback failed");
				}
				throw error;
			}
		});
	}

	close(): Promise<void> {
		return this.#enqueue(async () => {
			if (this.#closed) return;
			this.#closed = true;
			this.#client.release();
		});
	}
}
