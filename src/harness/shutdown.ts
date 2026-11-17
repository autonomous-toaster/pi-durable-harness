/**
 * Shutdown on a termination signal (tasks 3.1, 3.2).
 *
 * The framework's host checklist asks for `close()` on shutdown paths, because closing is what
 * stores a held (deferred) commit and joins running invocations. A normal return already closes;
 * a signal does not, so this installs the handler that does, bounded by a timeout so a wedged
 * invocation cannot keep the process alive forever.
 */

export interface ShutdownOptions {
	/** The close to run once, whatever triggers it. */
	readonly close: () => Promise<void>;
	/** How long to wait for the close before exiting anyway. */
	readonly timeoutMs?: number;
	/** Signals to handle; the defaults are the two an operator sends. */
	readonly signals?: readonly NodeJS.Signals[];
	/** Exit after closing; replaced in tests. */
	readonly exit?: (code: number) => void;
	/** Where the close's outcome is reported. */
	readonly report?: (line: string) => void;
}

/** The code a process exits with for an interrupt, as a shell reports it. */
const SIGNAL_EXIT: Readonly<Record<string, number>> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

/**
 * Install one idempotent shutdown: the first signal closes the session (bounded), reports what
 * happened, and exits with the shell's code for that signal. A second signal is ignored, so a
 * slow close cannot be interrupted into a torn exit and a fast double Ctrl+C does not skip it.
 *
 * Returns a function that removes the handlers, for a test or a long-lived host.
 */
export function installShutdown(options: ShutdownOptions): () => void {
	const timeoutMs = options.timeoutMs ?? 5_000;
	const signals = options.signals ?? (["SIGINT", "SIGTERM"] as const);
	const exit = options.exit ?? ((code: number) => process.exit(code));
	const report = options.report ?? ((line: string) => process.stderr.write(`pi-durable: ${line}\n`));
	let started = false;

	const handlers = signals.map((signal) => {
		const handler = (): void => {
			if (started) return;
			started = true;
			const code = SIGNAL_EXIT[signal] ?? 1;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const bounded = new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					report(`close did not finish within ${timeoutMs} ms (${signal}); exiting anyway`);
					resolve();
				}, timeoutMs);
				timer.unref?.();
			});
			void Promise.race([options.close().catch((error: unknown) => report(`close failed: ${error instanceof Error ? error.message : String(error)}`)), bounded])
				.then(() => {
					if (timer !== undefined) clearTimeout(timer);
					report(`closed on ${signal}`);
				})
				.finally(() => exit(code));
		};
		process.on(signal, handler);
		return () => process.off(signal, handler);
	});

	return () => {
		for (const remove of handlers) remove();
	};
}

/**
 * Resolve when `work` settles or when `timeoutMs` passes, whichever comes first. A close against a
 * dead PostgreSQL server can hang in `pool.end()` instead of rejecting, so every await on the road
 * to a reopen goes through this (task 2.5).
 */
export async function withTimeout(work: Promise<unknown>, timeoutMs: number): Promise<"settled" | "timed-out"> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const bounded = new Promise<"timed-out">((resolve) => {
		timer = setTimeout(() => resolve("timed-out"), timeoutMs);
		timer.unref?.();
	});
	const outcome = await Promise.race([
		work.then(
			() => "settled" as const,
			() => "settled" as const,
		),
		bounded,
	]);
	if (timer !== undefined) clearTimeout(timer);
	return outcome;
}
