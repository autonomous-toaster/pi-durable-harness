/**
 * The PostgreSQL suite's environment (tasks 1.1, 1.2).
 *
 * The conformance and parity suites need a real database. On a developer machine without one they
 * skip, which keeps the local loop fast. In a gate that must be a failure, not a skip: a suite that
 * silently does not run is how a process-fatal bug reached a commit.
 */

/** Whether this process is a gate: `CI` is how every runner declares it. */
export function isGate() {
	const value = process.env.CI;
	return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

/**
 * The database URL and the skip reason for one suite. In a gate without a URL the module throws at
 * import, so the file fails loudly instead of reporting green.
 */
export function testDatabase() {
	const configured = process.env.TEST_DATABASE_URL?.trim();
	const url = configured === "" ? undefined : configured;
	if (url === undefined && isGate()) {
		throw new Error(
			"TEST_DATABASE_URL is required in the gate: the PostgreSQL conformance and parity suites must run before a commit",
		);
	}
	return { url, skip: url === undefined ? "no TEST_DATABASE_URL" : false };
}
