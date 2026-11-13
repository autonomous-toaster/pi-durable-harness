/**
 * The schema this backend creates, in its final shape.
 *
 * Durable's migration list is a history: version 1 creates the tables, version 2
 * rebuilds `tasks` to add the `sleeping` status, which exists only because a database
 * created by an older build has to be upgraded. We create no such database, so the
 * backend writes the latest definition of each table once and records the current
 * version, which is what makes the core's migration pass a no-op.
 *
 * The statements are durable's own, so a re-pin moves them with it: the version is
 * read from the package, and the tasks definition is taken from the last migration
 * that declares it rather than copied here.
 */
import { CURRENT_SQLITE_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "@earendil-works/pi-durable/storage/sqlite";

/** The table a `CREATE TABLE` declares, and whether it is a rebuild's copy. */
function createdTable(statement: string): { readonly table: string; readonly rebuild: boolean } | undefined {
	const match = /^CREATE TABLE (\w+) \(/.exec(statement.replaceAll(/\s+/g, " ").trim());
	if (match === null) return undefined;
	const name = match[1] ?? "";
	return { table: name.replace(/_v2$/, ""), rebuild: name.endsWith("_v2") };
}

/** The index a `CREATE INDEX` declares, with the name Postgres will enforce. */
function createdIndex(statement: string): string | undefined {
	return /^CREATE (?:UNIQUE )?INDEX (\w+)/i.exec(statement.replaceAll(/\s+/g, " ").trim())?.[1];
}

/** Steps a rebuild uses to copy a table onto a new definition; a fresh schema has nothing to copy. */
function isRebuildStep(statement: string): boolean {
	const sql = statement.replaceAll(/\s+/g, " ").trim();
	return /^INSERT INTO \w+_v2\b/i.test(sql) || /^DROP TABLE\b/i.test(sql) || /^ALTER TABLE \w+_v2\b/i.test(sql);
}

/**
 * Every statement a fresh schema needs. Each table is created from its latest
 * definition — the one a rebuild would have produced — and the copy, drop, and rename
 * steps are left out, since there is no history to carry over. Statements are emitted
 * in the order durable declares them, so a child's table exists before its index.
 */
/**
 * The version table. Chord, which runs durable's migrations, creates it when it is
 * missing; the backend creates it here so it can record the version before the core
 * ever looks, which is what leaves the migration pass nothing to apply.
 */
export const VERSION_TABLE = "durable_schema";

export function initialSchemaStatements(): string[] {
	const first = SQLITE_MIGRATIONS.find((migration) => migration.version === 1)?.statements ?? [];
	const latest = new Map<string, string>();
	for (const migration of SQLITE_MIGRATIONS) {
		for (const statement of migration.statements) {
			const created = createdTable(statement);
			if (created !== undefined && created.rebuild) latest.set(created.table, statement);
		}
	}
	const emitted = new Set<string>();
	const statements: string[] = [
		`CREATE TABLE ${VERSION_TABLE} ( singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version >= 0) )`,
	];
	for (const statement of first) {
		const created = createdTable(statement);
		if (created !== undefined) {
			const definition = latest.get(created.table) ?? statement;
			statements.push(definition.replace(/CREATE TABLE (\w+)_v2 \(/, "CREATE TABLE $1 ("));
			continue;
		}
		const index = createdIndex(statement);
		if (index !== undefined && emitted.has(index)) continue;
		if (index !== undefined) emitted.add(index);
		// Every session seeds its own metadata row, so the insert must be repeatable.
		statements.push(statement.replace(/^INSERT INTO (\w+)/i, "INSERT OR IGNORE INTO $1"));
	}
	// A later migration may add an index on a table that has not changed.
	for (const migration of SQLITE_MIGRATIONS.slice(1)) {
		for (const statement of migration.statements) {
			if (createdTable(statement) !== undefined || isRebuildStep(statement)) continue;
			const index = createdIndex(statement);
			if (index === undefined || emitted.has(index)) continue;
			emitted.add(index);
			statements.push(statement);
		}
	}
	return statements;
}

/** The version this build writes, so the core's migration pass has nothing left to do. */
export const SCHEMA_VERSION = CURRENT_SQLITE_SCHEMA_VERSION;
