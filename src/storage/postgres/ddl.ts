/**
 * Translate Pi Durable's portable SQLite dialect into PostgreSQL (task 2.1).
 *
 * The storage core and its migrations speak standard SQL with `?` bindings,
 * `STRICT` tables, and `json_valid(...)` column checks. PostgreSQL needs:
 *  - `?` placeholders rewritten to `$n`,
 *  - `STRICT` table options dropped,
 *  - `INTEGER` mapped to `BIGINT` (SQLite integers are 64-bit; minted IDs can
 *    exceed PostgreSQL's 32-bit `integer`),
 *  - `json_valid(...)` checks dropped (the column stays `text`; the core parses
 *    JSON itself, so no cast is needed),
 *  - `INSERT OR IGNORE INTO` rewritten to `INSERT ... ON CONFLICT DO NOTHING`,
 *  - `json_each(?)` rewritten to `json_array_elements(?::json)` (one JSON array
 *    parameter, as Durable's multi-row statements expect),
 *  - `json_extract(alias.value, '$[n]')` rewritten to `(alias.value #>> '{n}')`.
 */

/** Rewrite `?` placeholders to `$n`, ignoring question marks inside string literals. */
export function translatePlaceholders(sql: string): string {
	let out = "";
	let index = 0;
	let inString = false;
	for (let position = 0; position < sql.length; position++) {
		const character = sql[position]!;
		if (inString) {
			out += character;
			if (character === "'") {
				if (sql[position + 1] === "'") {
					out += "'";
					position += 1;
				} else {
					inString = false;
				}
			}
			continue;
		}
		if (character === "'") {
			inString = true;
			out += character;
			continue;
		}
		if (character === "?") {
			index += 1;
			out += `$${index}`;
			continue;
		}
		out += character;
	}
	return out;
}

export function translateStatement(sql: string): string {
	const ignore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql);
	const body = sql
		.replace(/\s+STRICT\b/gi, "")
		.replace(/\bINTEGER\b/gi, "BIGINT")
		.replace(/CHECK\s*\(\s*json_valid\s*\([^)]*\)\s*\)/gi, "")
		.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO")
		.replace(/json_each\(\s*\?\s*\)/gi, "json_array_elements(?::json)")
		.replace(
			/IN\s*\(\s*SELECT\s+value\s+FROM\s+json_array_elements\(\?::json\)\s*\)/gi,
			"IN (SELECT (value #>> '{}')::bigint FROM json_array_elements(?::json))",
		)
		.replace(
			/(\w+)\.(\w+)\s*=\s*json_extract\(\s*(\w+)\.value\s*,\s*'\$\[(\d+)\]'\s*\)/gi,
			"(($1.$2)::text = ($3.value #>> '{$4}'))",
		)
		.replace(/\brequested\.value\b/gi, "(requested.value #>> '{}')::bigint")
		.replace(/json_extract\(\s*(\w+)\.value\s*,\s*'\$\[(\d+)\]'\s*\)/gi, "($1.value #>> '{$2}')");
	const translated = translatePlaceholders(body);
	return ignore ? `${translated} ON CONFLICT DO NOTHING` : translated;
}
