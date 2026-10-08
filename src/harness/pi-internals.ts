/**
 * Access to pi's internal codemode description composer (part of task 5.6).
 * The package `exports` map hides `extensions/codemode/tool.ts`, so it is
 * imported by file URL relative to this module. Reusing pi's own composer is
 * what makes the `codemode` description match exactly.
 */
const codemodeToolModule = await import(
	new URL("../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js", import.meta.url).href
);

export interface PiCodemodeTool {
	readonly name: string;
	readonly description: string;
	readonly parameters: unknown;
	readonly outputSchema?: unknown;
}

export interface PiCodemodeDescriptionOptions {
	readonly namespaces?: ReadonlyMap<string, { readonly name: string; readonly description?: string }>;
	readonly guidelines?: ReadonlyMap<string, readonly string[]>;
	readonly deferred?: ReadonlySet<string>;
	readonly inlineBudget?: number;
	readonly models?: boolean;
}

interface PiCodemodeModule {
	createCodemodeDescription(tools: readonly PiCodemodeTool[], options?: PiCodemodeDescriptionOptions): string;
	DEFAULT_CODEMODE_INLINE_BUDGET: number;
}

// SAFETY: this is pi's own `extensions/codemode/tool.js`; its runtime shape matches
// the narrowed interface, and both members used here are exported by that file.
const mod = codemodeToolModule as unknown as PiCodemodeModule;

export const DEFAULT_CODEMODE_INLINE_BUDGET = mod.DEFAULT_CODEMODE_INLINE_BUDGET;

export function createCodemodeDescription(
	tools: readonly PiCodemodeTool[],
	options: PiCodemodeDescriptionOptions = {},
): string {
	return mod.createCodemodeDescription(tools, options);
}
