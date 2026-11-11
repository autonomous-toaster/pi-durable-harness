/**
 * The bridge between an extension's `ctx.ui` dialog calls and the attached RPC
 * client (tasks 3.1-3.3).
 *
 * A dialog is a property of the live connection, not of durable state: the
 * client is registered by `RpcServer` while it serves, and every pending answer
 * is settled when the run aborts, the input closes, or the process shuts down.
 * A dialog therefore does not survive a reconnect, which the README records.
 */

/** One answer to a dialog: a value, a confirmation, or a cancellation. */
export interface UiAnswer {
	readonly value?: string;
	readonly confirmed?: boolean;
	readonly cancelled?: boolean;
}

/** One dialog request, as pi's envelope carries it. */
export interface UiRequest {
	readonly method: "select" | "confirm" | "input" | "editor";
	readonly payload: Readonly<Record<string, unknown>>;
	readonly timeout?: number;
	readonly signal?: AbortSignal;
}

/** Sends one request and resolves its answer; the RPC server implements this. */
export type UiClient = (request: UiRequest) => Promise<UiAnswer>;

const CANCELLED: UiAnswer = { cancelled: true };

let client: UiClient | undefined;

/** Attach or detach the client that answers dialogs. */
export function setUiClient(next: UiClient | undefined): void {
	client = next;
}

/** Whether a client can answer a dialog now. */
export function hasUiClient(): boolean {
	return client !== undefined;
}

/**
 * Ask the client, or answer cancelled when none is attached. A client that
 * rejects is treated as a cancellation so a tool never fails on a dialog.
 */
async function ask(request: UiRequest): Promise<UiAnswer> {
	const current = client;
	if (current === undefined) return CANCELLED;
	try {
		return await current(request);
	} catch {
		return CANCELLED;
	}
}

/** pi's four dialog methods, bound to the attached client (task 3.2). */
export function dialogMethods(): {
	select(title: string, options: string[], opts?: { signal?: AbortSignal; timeout?: number }): Promise<string | undefined>;
	confirm(title: string, message: string, opts?: { signal?: AbortSignal; timeout?: number }): Promise<boolean>;
	input(title: string, placeholder?: string, opts?: { signal?: AbortSignal; timeout?: number }): Promise<string | undefined>;
	editor(title: string, prefill?: string): Promise<string | undefined>;
} {
	return {
		select: async (title, options, opts) =>
			(await ask({ method: "select", payload: { title, options }, ...(opts ?? {}) })).value,
		confirm: async (title, message, opts) =>
			(await ask({ method: "confirm", payload: { title, message }, ...(opts ?? {}) })).confirmed === true,
		input: async (title, placeholder, opts) =>
			(
				await ask({
					method: "input",
					payload: { title, ...(placeholder === undefined ? {} : { placeholder }) },
					...(opts ?? {}),
				})
			).value,
		editor: async (title, prefill) =>
			(await ask({ method: "editor", payload: { title, ...(prefill === undefined ? {} : { prefill }) } })).value,
	};
}
