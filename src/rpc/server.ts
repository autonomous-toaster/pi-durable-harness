/**
 * The pi-RPC JSONL server: reads commands, dispatches them, correlates
 * responses by id, and streams session events (tasks 3.2, 3.3, 3.5, 3.4).
 *
 * Record handling matches the pinned pi 1.1.0 (see test/fixtures): malformed
 * JSON is answered with a `success: false` response that carries no `command`
 * and no `id`; an unknown command is answered by name; `extension_ui_response`
 * is ignored without ending the process.
 */
import type { Readable, Writable } from "node:stream";
import { encodeJsonl, readJsonl, writeJsonl } from "./framing.js";
import type { RpcCommand, RpcSession } from "./protocol.js";

export class RpcServer {
	readonly #session: RpcSession;
	readonly #input: Readable;
	readonly #output: Writable;
	#detach: (() => Promise<void>) | undefined;
	#closing = false;

	constructor(session: RpcSession, input: Readable, output: Writable) {
		this.#session = session;
		this.#input = input;
		this.#output = output;
	}

	async #write(record: unknown): Promise<void> {
		if (this.#output.writableEnded) return;
		await writeJsonl(this.#output, record);
	}

	async #respond(id: string | undefined, command: string, data: unknown): Promise<void> {
		await this.#write({ ...(id === undefined ? {} : { id }), type: "response", command, success: true, ...(data === undefined ? {} : { data }) });
	}

	async #fail(id: string | undefined, command: string | undefined, error: string): Promise<void> {
		await this.#write({
			...(id === undefined ? {} : { id }),
			type: "response",
			...(command === undefined ? {} : { command }),
			success: false,
			error,
		});
	}

	async run(): Promise<void> {
		this.#detach = await this.#session.startEvents((record) => {
			void this.#write(record);
		});
		for await (const line of readJsonl(this.#input)) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				await this.#fail(undefined, undefined, "Unknown command: undefined");
				continue;
			}
			if (typeof parsed !== "object" || parsed === null || typeof (parsed as RpcCommand).type !== "string") {
				await this.#fail(undefined, undefined, "Unknown command: undefined");
				continue;
			}
			const command = parsed as RpcCommand;
			if (command.type === "extension_ui_response") continue;
			await this.#dispatch(command);
		}
		await this.#stop();
	}

	async #stop(): Promise<void> {
		if (this.#closing) return;
		this.#closing = true;
		if (this.#detach !== undefined) await this.#detach().catch(() => {});
	}

	async #dispatch(command: RpcCommand): Promise<void> {
		const id = command.id;
		try {
			switch (command.type) {
				case "prompt": {
					const message = String(command.message ?? "");
					const images = Array.isArray(command.images) ? command.images : undefined;
					const behavior = command.streamingBehavior as "steer" | "followUp" | undefined;
					const result = await this.#session.submit(message, images, behavior);
					await this.#respond(id, "prompt", result);
					return;
				}
				case "steer": {
					const images = Array.isArray(command.images) ? command.images : undefined;
					const result = await this.#session.submit(String(command.message ?? ""), images, "steer");
					await this.#respond(id, "steer", result);
					return;
				}
				case "follow_up": {
					const images = Array.isArray(command.images) ? command.images : undefined;
					const result = await this.#session.submit(String(command.message ?? ""), images, "followUp");
					await this.#respond(id, "follow_up", result);
					return;
				}
				case "abort":
					await this.#session.abort();
					await this.#respond(id, "abort", undefined);
					return;
				case "clear_queue":
					await this.#session.clearQueue();
					await this.#respond(id, "clear_queue", undefined);
					return;
				case "get_state":
					await this.#respond(id, "get_state", await this.#session.state());
					return;
				case "get_messages":
					await this.#respond(id, "get_messages", await this.#session.messages());
					return;
				case "get_entries":
					await this.#respond(id, "get_entries", await this.#session.entries());
					return;
				case "get_tree":
					await this.#respond(id, "get_tree", await this.#session.tree());
					return;
				case "get_last_assistant_text":
					await this.#respond(id, "get_last_assistant_text", await this.#session.lastAssistantText());
					return;
				case "get_session_stats":
					await this.#respond(id, "get_session_stats", await this.#session.sessionStats());
					return;
				case "get_available_models":
					await this.#respond(id, "get_available_models", await this.#session.availableModels());
					return;
				case "get_available_thinking_levels":
					await this.#respond(id, "get_available_thinking_levels", await this.#session.availableThinkingLevels());
					return;
				case "get_commands":
					await this.#respond(id, "get_commands", await this.#session.getCommands());
					return;
				case "set_model": {
					const result = await this.#session.setModel(String(command.provider ?? ""), String(command.modelId ?? ""));
					if (!result.ok) await this.#fail(id, "set_model", result.error ?? "Model not found");
					else await this.#respond(id, "set_model", undefined);
					return;
				}
				case "set_thinking_level":
					await this.#session.setThinkingLevel(String(command.level ?? ""));
					await this.#respond(id, "set_thinking_level", undefined);
					return;
				case "set_steering_mode":
					await this.#session.setSteeringMode(String(command.mode ?? ""));
					await this.#respond(id, "set_steering_mode", undefined);
					return;
				case "set_follow_up_mode":
					await this.#session.setFollowUpMode(String(command.mode ?? ""));
					await this.#respond(id, "set_follow_up_mode", undefined);
					return;
				case "compact":
					await this.#session.compact(command.customInstructions === undefined ? undefined : String(command.customInstructions));
					await this.#respond(id, "compact", {});
					return;
				case "bash": {
					const commandId = command.id;
					const result = await this.#session.bash(String(command.command ?? ""), (delta) => {
						void this.#write({ type: "bash_execution_update", ...(commandId === undefined ? {} : { id: commandId }), delta });
					});
					await this.#respond(id, "bash", result);
					return;
				}
				case "abort_bash":
					await this.#session.abortBash();
					await this.#respond(id, "abort_bash", undefined);
					return;
				case "set_auto_compaction":
					await this.#session.setAutoCompaction(command.enabled === true);
					await this.#respond(id, "set_auto_compaction", undefined);
					return;
				case "set_auto_retry":
					await this.#session.setAutoRetry(command.enabled === true);
					await this.#respond(id, "set_auto_retry", undefined);
					return;
				case "abort_retry":
					await this.#session.abortRetry();
					await this.#respond(id, "abort_retry", undefined);
					return;
				case "cycle_model":
					await this.#respond(id, "cycle_model", await this.#session.cycleModel());
					return;
				case "cycle_thinking_level":
					await this.#respond(id, "cycle_thinking_level", await this.#session.cycleThinkingLevel());
					return;
				case "export_html":
					await this.#respond(
						id,
						"export_html",
						await this.#session.exportHtml(command.outputPath === undefined ? undefined : String(command.outputPath)),
					);
					return;
				case "new_session":
					await this.#respond(
						id,
						"new_session",
						await this.#session.newSession(command.parentSession === undefined ? undefined : String(command.parentSession)),
					);
					return;
				case "switch_session":
					await this.#respond(id, "switch_session", await this.#session.switchSession(String(command.sessionPath ?? "")));
					return;
				case "fork":
					await this.#respond(id, "fork", await this.#session.fork(String(command.entryId ?? "")));
					return;
				case "clone":
					await this.#respond(id, "clone", await this.#session.clone());
					return;
				case "get_fork_messages":
					await this.#respond(id, "get_fork_messages", await this.#session.getForkMessages());
					return;
				case "set_session_name":
					await this.#session.setSessionName(String(command.name ?? ""));
					await this.#respond(id, "set_session_name", undefined);
					return;
				default:
					await this.#fail(id, command.type, `Unknown command: ${command.type}`);
					return;
			}
		} catch (error) {
			await this.#fail(id, command.type, error instanceof Error ? error.message : String(error));
		}
	}
}

export { encodeJsonl };
