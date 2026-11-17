/**
 * What the framework reports, and what a host does about it (tasks 1.1, 1.2, 4.1).
 *
 * Durable hands a host one report per problem: an error plus a `kind` that says what the problem
 * is about. Three classes need three reactions — a failed session is reopened, a faulted task is
 * shown where the user is looking, and everything else is a diagnostic. A run that ends without an
 * answer names a reason, and each reason has its own advice. Pure functions, so the vocabulary is
 * asserted in a test rather than discovered in production.
 */

/** How a host must react. */
export type ReportClass = "session" | "task" | "diagnostic";

export interface ClassifiedReport {
	readonly class: ReportClass;
	/** The framework's `kind`, kept for the message and for a caller that wants to branch. */
	readonly kind: string;
	readonly line: string;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Classify one `Report` from `HarnessOptions.onReport`.
 *
 * `storage_failed` is the session's own death: every later commit rejects until the session is
 * reopened, so the host reopens. Task kinds (`task_faulted`, `task_interrupted`, `migration_failed`,
 * `task_outdated`, `task_error`) leave the session usable and belong in front of the user. Anything
 * else (an extension, a host callback, a listener) is a diagnostic.
 */
export function classifyReport(report: { readonly kind?: string; readonly error?: unknown; readonly reason?: string }): ClassifiedReport {
	const kind = typeof report.kind === "string" ? report.kind : "unknown";
	const message = messageOf(report.error);
	if (kind === "storage_failed") {
		return { class: "session", kind, line: `storage failed (${message}); reopening the session` };
	}
	// `migration_failed` also carries a task record, so it is a task failure, not a diagnostic.
	if (kind.startsWith("task_") || kind === "migration_failed") {
		const reason = typeof report.reason === "string" ? `, ${report.reason}` : "";
		return { class: "task", kind, line: `a task ended ${kind.slice(5).replaceAll("_", " ")}${reason}: ${message}` };
	}
	return { class: "diagnostic", kind, line: `${kind.replaceAll("_", " ")}: ${message}` };
}

/** The advice the framework gives for a reason a run ended without an answer. */
export function adviceFor(reason: string): string {
	switch (reason) {
		case "model_error":
		case "no_model":
			return "fix the model or provider configuration, then retry the input";
		case "restart_limit":
			return "the run was cut off repeatedly; fix the crash loop or raise the restart limit";
		case "invalid_park":
			return "a tool parked with an invalid gate; fix the tool's park call";
		case "turn_limit":
			return "raise the turn limit or narrow the task";
		case "nothing_to_answer":
			return "the context had nothing to answer; this is a caller bug, do not continue blindly";
		case "stale":
			return "the input was replaced before it could be answered; retry it";
		case "aborted":
			return "the run was cancelled; nothing to fix";
		default:
			return "the framework named no advice for this reason";
	}
}

/**
 * The reason a settled submission carries when it did not answer. A `done` submission has no
 * reason, so `undefined` means the run answered.
 */
export function unansweredReason(settled: { readonly status?: string; readonly reason?: string }): string | undefined {
	if (settled.status !== "unanswered") return undefined;
	return typeof settled.reason === "string" && settled.reason.length > 0 ? settled.reason : "unanswered";
}

/** One line for a run that did not answer, and the advice that follows from the reason. */
export function outcomeLine(reason: string): string {
	return `the run ended unanswered (${reason}); ${adviceFor(reason)}`;
}

/** How long to wait before reopen attempt `attempt` (1-based): 1s, 2s, 4s… capped at 30s (task 2.4). */
export function reopenDelayMs(attempt: number): number {
	return Math.min(30_000, 1_000 * 2 ** Math.min(Math.max(attempt, 1) - 1, 5));
}

/** How long a catalog stamp stays fresh enough for `-c` (task 5.1). */
export const STAMP_INTERVAL_MS = 60_000;

/** Whether a turn should write the catalog stamp now; the first turn of a process always does. */
export function shouldStamp(input: { readonly now: number; readonly stampedAt: number }): boolean {
	return input.stampedAt === 0 || input.now - input.stampedAt >= STAMP_INTERVAL_MS;
}
