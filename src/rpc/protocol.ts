/**
 * The RPC session contract the server dispatches to (tasks 3.2, 3.3). The
 * durable engine implements it; tests can supply a stub. Methods return the
 * `data` payload pi puts in the response, with the shapes captured from the
 * pinned pi 1.1.0 (see test/fixtures).
 */
export interface RpcSession {
	readonly sessionId: string;
	state(): Promise<Record<string, unknown>>;
	submit(
		message: string,
		images: readonly unknown[] | undefined,
		behavior: "steer" | "followUp" | undefined,
	): Promise<{ disposition: string }>;
	abort(): Promise<void>;
	clearQueue(): Promise<void>;
	compact(instructions: string | undefined): Promise<void>;
	setAutoCompaction(enabled: boolean): Promise<void>;
	setAutoRetry(enabled: boolean): Promise<void>;
	abortRetry(): Promise<void>;
	messages(): Promise<{ messages: unknown[] }>;
	entries(): Promise<{ entries: unknown[]; leafId: string | null }>;
	tree(): Promise<{ tree: unknown; leafId: string | null }>;
	lastAssistantText(): Promise<{ text?: string }>;
	sessionStats(): Promise<Record<string, unknown>>;
	exportHtml(outputPath: string | undefined): Promise<{ path: string }>;
	availableModels(): Promise<{ models: unknown[] }>;
	setModel(provider: string, modelId: string): Promise<{ ok: boolean; error?: string }>;
	cycleModel(): Promise<{ model: unknown }>;
	setThinkingLevel(level: string): Promise<void>;
	cycleThinkingLevel(): Promise<{ level: string }>;
	availableThinkingLevels(): Promise<{ levels: string[] }>;
	setSteeringMode(mode: string): Promise<void>;
	setFollowUpMode(mode: string): Promise<void>;
	newSession(parentSession: string | undefined): Promise<{ canceled: boolean }>;
	switchSession(sessionPath: string): Promise<{ canceled: boolean }>;
	fork(entryId: string): Promise<{ text: string; canceled: boolean }>;
	clone(): Promise<{ canceled: boolean }>;
	getForkMessages(): Promise<{ messages: unknown[] }>;
	setSessionName(name: string): Promise<void>;
	bash(command: string, onOutput: (delta: string) => void): Promise<{ output: string; exitCode: number }>;
	abortBash(): Promise<void>;
	getCommands(): Promise<{ commands: unknown[] }>;
	/** Attach the session event stream; resolves to a detach function. */
	startEvents(sink: (record: unknown) => void): Promise<() => Promise<void>>;
}

export interface RpcCommand {
	readonly id?: string;
	readonly type: string;
	readonly [key: string]: unknown;
}
