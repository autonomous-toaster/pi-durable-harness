/**
 * The PostgreSQL backend's table layout.
 *
 * The portable core names its tables after its prefix, one set per session. On a
 * server that means nine tables per session — a thousand sessions, nine thousand
 * tables, each a catalog entry, a lock target, and a migration that runs again. The
 * backend therefore keeps one table set for the whole schema and puts the session in
 * a `session` column, which is what PostgreSQL offers for exactly this: a
 * row-level-security policy, scoped to a GUC the pool sets on connect, does the
 * filtering the prefix used to do. The statements the core issues need no session
 * predicate; only their table names lose the prefix.
 */

/** The policy name used on every table; per table, so one name is enough. */
const POLICY = "session_scope";

/**
 * The role the session runs as. Supabase's `postgres` is created with BYPASSRLS, and
 * a role that bypasses row-level security bypasses policies and FORCE alike, so the
 * policy would silently scope nothing. This role owns nothing privileged, and a
 * `SET ROLE` into it is what makes the isolation real.
 */
export const SCOPE_ROLE = "durable_scope";

/**
 * Make the scope role usable: create it, let the connecting user become it, and give
 * it the schema so the migrations it runs create tables it owns — which FORCE applies
 * to. Every statement is idempotent, so each session can run it.
 */
export function scopeRoleSetup(schema: string): string[] {
	const quoted = `"${schema.replaceAll('"', '""')}"`;
	return [
		`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${SCOPE_ROLE}') THEN CREATE ROLE ${SCOPE_ROLE} NOLOGIN; END IF; END $$`,
		`GRANT USAGE, CREATE ON SCHEMA ${quoted} TO ${SCOPE_ROLE}`,
		`GRANT ${SCOPE_ROLE} TO CURRENT_USER`,
		`ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoted} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${SCOPE_ROLE}`,
		`SET ROLE ${SCOPE_ROLE}`,
	];
}

/**
 * Drop the table prefix from a statement. Durable's prefix carries its own trailing
 * underscore (`s_1a2b3c4d5e6f_`), so the separator is optional here: a caller that
 * passes one without it still gets `entries`, not `_entries`.
 */
export function stripPrefix(prefix: string, sql: string): string {
	const escaped = prefix.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return sql.replaceAll(new RegExp(`\\b${escaped}(_?)`, "g"), "");
}

interface TableDdl {
	readonly name: string;
	readonly body: string;
}

/** The head and body of a `CREATE TABLE`, or undefined for any other statement. */
function parseCreateTable(sql: string): TableDdl | undefined {
	const match = /^(\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)([\w."]+)\s*\(([\s\S]*)\)\s*$/.exec(sql);
	if (match === null) return undefined;
	return { name: match[2]!.replaceAll('"', ""), body: match[3]! };
}

/**
 * Add the session column and make every key start with it, so one session's rows can
 * never collide with another's ids. A session with no GUC set gets NULL, and the NOT
 * NULL refuses the write rather than filing the row under someone else.
 */
export function scopeTable(ddl: TableDdl): string {
	const inline: string[] = [];
	// Inline `id BIGINT PRIMARY KEY` becomes a table-level key that starts with session;
	// a key already written at table level is extended the same way. Order matters: the
	// inline form is folded first, so its keyword is never left dangling.
	const withoutInline = ddl.body.replace(
		/\b(\w+)\s+(BIGINT|TEXT|INTEGER)\s+PRIMARY\s+KEY\b/gi,
		(_whole, column: string, type: string) => {
			inline.push(column);
			// The type stays; only the key clause moves to the table level.
			return `${column} ${type}`;
		},
	);
	const hasTableKey = /\bPRIMARY\s+KEY\s*\(/i.test(withoutInline);
	const columns = withoutInline.replace(/\bUNIQUE\s*\(\s*([^)]*)\)/gi, (_whole, cols: string) => `UNIQUE (session, ${cols})`);
	const keys = hasTableKey
		? ""
		: inline.length > 0
			? `, PRIMARY KEY (session, ${inline.join(", ")})`
			: "";
	const scopedTableKey = keys === "" ? columns.replace(/\bPRIMARY\s+KEY\s*\(\s*([^)]*)\)/i, "PRIMARY KEY (session, $1)") : columns;
	// Shared, the table set is created once and every later session finds it there, so
	// the creation is idempotent whoever runs it first.
	return `CREATE TABLE IF NOT EXISTS ${ddl.name} (session TEXT NOT NULL DEFAULT current_setting('app.session', true),${scopedTableKey}${keys})`;
}

/** Prefix an index's column list with the session, and make its creation idempotent. */
export function scopeIndex(sql: string): string {
	const match = /^(\s*CREATE\s+(UNIQUE\s+)?INDEX\s+)(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)(\s+ON\s+)([\w."]+)\s*\(([^)]*)\)([\s\S]*)$/i.exec(sql);
	if (match === null) return sql;
	const [, head, unique, name, on, table, columns, tail] = match;
	return `${head}IF NOT EXISTS ${name}${on}${table} (session, ${columns})${tail}`;
}

/** The statements that put one table under the session policy, safe to run again. */
export function policies(table: string): string[] {
	const scoped = `session = current_setting('app.session', true)`;
	return [
		`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
		// FORCE, so the table's owner is scoped too: the connecting role owns these tables.
		`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
		`DROP POLICY IF EXISTS ${POLICY} ON ${table}`,
		`CREATE POLICY ${POLICY} ON ${table} USING (${scoped}) WITH CHECK (${scoped})`,
	];
}

export interface TranslationContext {
	readonly prefix: string;
}

/** Apply the backend's layout to a translated statement. */
export async function applyLayout(sql: string, context: TranslationContext): Promise<{ readonly sql: string; readonly after: readonly string[] }> {
	const stripped = stripPrefix(context.prefix, sql);
	const table = parseCreateTable(stripped);
	if (table !== undefined) {
		return { sql: scopeTable(table), after: policies(table.name) };
	}
	if (/^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(stripped)) {
		return { sql: scopeIndex(stripped), after: [] };
	}
	// Every key now starts with session, so an upsert must name it or PostgreSQL finds
	// no unique constraint matching the specification.
	const upsert = /^\s*INSERT/i.test(stripped)
		? stripped.replace(/ON\s+CONFLICT\s*\(\s*([^)]*)\)/gi, (_whole, cols: string) => `ON CONFLICT (session, ${cols})`)
		: stripped;
	return { sql: upsert, after: [] };
}
