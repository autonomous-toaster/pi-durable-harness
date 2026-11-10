import assert from "node:assert/strict";
import { test } from "node:test";
import { num, obj, opt, str } from "@earendil-works/pi-schema";
import { compile } from "@earendil-works/pi-schema";

const schema = obj({ path: str(), limit: opt(num()) });

test("pi-schema coercion converts a numeric string argument", () => {
	const validator = compile(schema, { coerce: true });
	const parsed = validator.parse({ path: "a", limit: "42" });
	assert.equal(parsed.ok, true);
	assert.deepEqual(parsed.value, { path: "a", limit: 42 });
});

test("pi-schema rejects a missing required argument", () => {
	const validator = compile(schema, { coerce: true });
	const result = validator.validate({ limit: 1 });
	assert.notEqual(result.ok, true);
});
