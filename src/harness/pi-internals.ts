/**
 * Access to pi's internal codemode description composer (part of task 5.6).
 * Reusing pi's own composer is what makes the `codemode` description match
 * exactly. Two ways in, because the package `exports` map hides the path:
 *
 *  - by specifier, which the bundler resolves and inlines, so the bundle is one
 *    file with no `node_modules` beside it;
 *  - by file URL, for the plain `dist/` build that Node runs directly, where the
 *    specifier is refused by the exports map.
 */
let loading: Promise<unknown> | undefined;

/** Load pi's composer once; the bundler inlines the specifier, `dist` falls back to the URL. */
export function loadCodemodeModule(): Promise<unknown> {
	// @ts-expect-error -- pi's exports map hides this path; the bundler resolves it.
	loading ??= import("@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js").catch(() =>
		import(new URL("../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js", import.meta.url).href),
	);
	return loading;
}

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

// pi's default (3000) as a literal, so that reading it never forces a module load.
export const DEFAULT_CODEMODE_INLINE_BUDGET = 3000;

export async function createCodemodeDescription(
	tools: readonly PiCodemodeTool[],
	options: PiCodemodeDescriptionOptions = {},
): Promise<string> {
	// SAFETY: this is pi's own `extensions/codemode/tool.js`; its runtime shape matches
	// the narrowed interface, and both members used here are exported by that file.
	const mod = (await loadCodemodeModule()) as unknown as PiCodemodeModule;
	return mod.createCodemodeDescription(tools, options);
}
