import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createStorageConformance } from "@earendil-works/pi-durable/testing";
import { openPostgresStorage, SessionLockedError } from "../dist/storage/postgres/storage.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url === undefined;

const assertions = {
	ok(value, message) {
		assert.ok(value, message);
	},
	strictEqual(actual, expected) {
		assert.strictEqual(actual, expected);
	},
	deepEqual(actual, expected) {
		assert.deepStrictEqual(actual, expected);
	},
	partialDeepEqual(actual, expected) {
		assert.ok(isPartial(actual, expected), `expected ${JSON.stringify(actual)} to match ${JSON.stringify(expected)}`);
	},
	greaterThan(actual, expected) {
		assert.ok(actual > expected, `${actual} > ${expected}`);
	},
	async rejects(operation, messageIncludes) {
		await assert.rejects(operation, (error) => String(error?.message ?? error).includes(messageIncludes));
	},
};

function isPartial(actual, expected) {
	if (Array.isArray(expected)) {
		return Array.isArray(actual) && actual.length === expected.length && expected.every((item, i) => isPartial(actual[i], item));
	}
	if (expected !== null && typeof expected === "object") {
		return expected !== undefined && actual !== null && typeof actual === "object"
			&& Object.entries(expected).every(([key, value]) => isPartial(actual[key], value));
	}
	return Object.is(actual, expected);
}

async function withStorage(use) {
	const schema = `harness_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
	const pool = new pg.Pool({ connectionString: url });
	const storage = await openPostgresStorage({ pool, schema });
	try {
		await use(storage);
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
		await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		await pool.end();
	}
}

for (const conformanceCase of createStorageConformance({ assertions, withStorage })) {
	test(conformanceCase.name, { skip }, () => conformanceCase.run());
}

test("a second writer for the same session is refused", { skip }, async () => {
	const schema = `harness_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
	const pool = new pg.Pool({ connectionString: url });
	const first = await openPostgresStorage({ pool, schema });
	try {
		await assert.rejects(openPostgresStorage({ pool, schema }), (error) => error instanceof SessionLockedError);
	} finally {
		await first.close(BACKGROUND_CONTEXT);
		await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		await pool.end();
	}
});
