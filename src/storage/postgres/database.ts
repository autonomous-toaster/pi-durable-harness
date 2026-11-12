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
import { applyLayout, scopeRoleSetup, type Layout, type TranslationContext } from "./layout.js";

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

const JSON_INSERT =
	/^\s*INSERT\s+INTO\s+(\S+)\s*\(([^)]*)\)\s*SELECT\s+([\s\S]*?)\s+FROM\s+json_each\(\s*\?\s*\)\s+AS\s+item\s+WHERE\s+true\s*([\s\S]*)$/i;

/**
 * Rewrite Durable's `INSERT ... SELECT json_extract(...) FROM json_each(?)` into a
 * `VALUES` list with real bindings, so PostgreSQL assigns each cell its column type
 * (a numeric JSON cell becomes a number, not text). Undefined when the statement
 * does not match.
 */
export function expandJsonInsert(
	sql: string,
	params: readonly SqliteValue[],
): { sql: string; params: SqliteValue[] } | undefined {
	const match = JSON_INSERT.exec(sql);
	if (match === null) return undefined;
	const [, table, columns, , conflict = ""] = match;
	const payload = params[0];
	if (typeof payload !== "string") return undefined;
	let rows: unknown[][];
	try {
		const parsed: unknown = JSON.parse(payload);
		if (!Array.isArray(parsed)) return undefined;
		rows = parsed as unknown[][];
	} catch {
		return undefined;
	}
	if (rows.length === 0) return undefined;
	const width = rows[0]!.length;
	const values: SqliteValue[] = [];
	const tuples = rows.map((row) => {
		const slots = row.map((cell) => {
			values.push((typeof cell === "object" && cell !== null ? JSON.stringify(cell) : cell) as SqliteValue);
			return `$${values.length}`;
		});
		return `(${slots.join(", ")})`;
	});
	void width;
	const suffix = conflict.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "").trim();
	return {
		sql: `INSERT INTO ${table} (${columns}) VALUES ${tuples.join(", ")}${suffix === "" ? "" : ` ${suffix}`}`,
		params: values,
	};
}

/** Translate, apply the layout, and run any statements the layout appends. */
async function statement(
	client: PoolClient,
	sql: string,
	params: readonly SqliteValue[],
	context: TranslationContext | undefined,
): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
	const translated = translateStatement(sql);
	const applied = context === undefined ? { sql: translated, after: [] } : await applyLayout(translated, context);
	// The scoped statement runs first: the policy statements act on the table it
	// creates, so running them before it is a relation that does not exist yet.
	const result = await client.query(applied.sql, params.map(normalize));
	for (const follow of applied.after) await client.query(follow);
	return result;
}

async function query(
	client: PoolClient,
	sql: string,
	params: readonly SqliteValue[],
	context: TranslationContext | undefined,
): Promise<{ rows: Record<string, unknown>[] }> {
	return statement(client, sql, params, context);
}

/** Executor bound to one connection; used both directly and inside a transaction. */
class PostgresExecutor implements SqliteExecutor {
	constructor(
		private readonly client: PoolClient,
		private readonly layout: TranslationContext | undefined,
	) {}

	async exec(sql: string): Promise<void> {
		await statement(this.client, sql, [], this.layout);
	}

	async run(sql: string, ...params: SqliteValue[]): Promise<void> {
		const expanded = expandJsonInsert(sql, params);
		if (expanded !== undefined) {
			const applied = this.layout === undefined ? { sql: expanded.sql, after: [] } : await applyLayout(expanded.sql, this.layout);
			await this.client.query(applied.sql, expanded.params.map(normalize));
			for (const follow of applied.after) await this.client.query(follow);
			return;
		}
		await query(this.client, sql, params, this.layout);
	}

	async runCounted(sql: string, ...params: SqliteValue[]): Promise<number> {
		const result = await statement(this.client, sql, params, this.layout);
		return result.rowCount ?? 0;
	}

	async get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
		return (await query(this.client, sql, params, this.layout)).rows[0] as T | undefined;
	}

	async all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
		return (await query(this.client, sql, params, this.layout)).rows as T[];
	}
}

export class PostgresDatabase implements SqliteDatabase {
	readonly #client: PoolClient;
	#tail: Promise<unknown> = Promise.resolve();
	#closed = false;

	readonly #layout: TranslationContext | undefined;

	private constructor(client: PoolClient, layout: TranslationContext | undefined) {
		configureTypes();
		this.#client = client;
		this.#layout = layout;
	}

	/** Acquire one connection, create the session schema, and target it. */
	static async open(pool: Pool, schema: string, options?: { readonly prefix: string; readonly layout: Layout }): Promise<PostgresDatabase> {
		const client = await pool.connect();
		try {
			await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
			await client.query(`SET search_path TO ${quoteIdent(schema)}`);
			// The policy reads this; set here as well, so a pool without the startup
			// option still scopes its rows instead of writing them with a NULL session.
			if (options !== undefined && options.layout === "shared") {
				// The role must be assumed before anything is written, and the policy reads
				// the GUC this sets.
				for (const statement of scopeRoleSetup(schema)) await client.query(statement);
				await client.query("SELECT set_config('app.session', $1, false)", [options.prefix]);
			}
		} catch (error) {
			client.release();
			throw error;
		}
		return new PostgresDatabase(client, options === undefined ? undefined : { prefix: options.prefix, layout: options.layout });
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
		return this.#enqueue(() => new PostgresExecutor(this.#client, this.#layout).exec(sql));
	}

	run(sql: string, ...params: SqliteValue[]): Promise<void> {
		return this.#enqueue(() => new PostgresExecutor(this.#client, this.#layout).run(sql, ...params));
	}

	runCounted(sql: string, ...params: SqliteValue[]): Promise<number> {
		return this.#enqueue(() => new PostgresExecutor(this.#client, this.#layout).runCounted(sql, ...params));
	}

	get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
		return this.#enqueue(() => new PostgresExecutor(this.#client, this.#layout).get<T>(sql, ...params));
	}

	all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
		return this.#enqueue(() => new PostgresExecutor(this.#client, this.#layout).all<T>(sql, ...params));
	}

	transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
		return this.#enqueue(async () => {
			await this.#client.query("BEGIN");
			try {
				const result = await callback(new PostgresExecutor(this.#client, this.#layout));
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
