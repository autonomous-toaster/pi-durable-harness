import assert from "node:assert/strict";
import { test } from "node:test";
import { applyProcessMarkers, AGENT_MARKER, HARNESS_PROCESS_TITLE } from "../dist/process-markers.js";

test("entry markers match pi", () => {
	applyProcessMarkers();
	assert.equal(process.env.AI_AGENT, AGENT_MARKER);
	assert.equal(process.env.PI_CODING_AGENT, "true");
	assert.equal(process.title, HARNESS_PROCESS_TITLE);
});
