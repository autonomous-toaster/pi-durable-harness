/**
 * Port of pi's system-prompt section builder (task 5.3). The logic is copied
 * from `@earendil-works/pi-coding-agent`'s `core/system-prompt.ts` (MIT) so the
 * rendered sections are identical; it imports the same exported helpers pi uses.
 */
import { getSystemMessageText } from "@earendil-works/pi-ai";
import { formatSkillsForPrompt, getDocsPath, getExamplesPath, getReadmePath, type Skill } from "@earendil-works/pi-coding-agent";

const SYSTEM_PROMPT_SECTION_NAME = /^[a-z][a-z0-9_-]*$/;

export interface BuildSystemPromptInput {
	readonly customPrompt?: string | undefined;
	readonly selectedTools?: readonly string[] | undefined;
	readonly hiddenTools?: readonly string[] | undefined;
	readonly toolSnippets?: Readonly<Record<string, string>> | undefined;
	readonly toolGuidelines?: Readonly<Record<string, readonly string[]>> | undefined;
	readonly promptGuidelines?: readonly string[] | undefined;
	readonly appendSystemPrompt?: string | undefined;
	readonly sections?: Readonly<Record<string, string>> | undefined;
	readonly cwd: string;
	readonly contextFiles?: readonly { readonly path: string; readonly content: string }[] | undefined;
	readonly skills?: readonly Skill[] | undefined;
}

export type SystemPromptSections = Record<string, string>;

function renderProjectContext(contextFiles: readonly { readonly path: string; readonly content: string }[]): string {
	return [
		"Project-specific instructions and guidelines:",
		...contextFiles.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`),
	].join("\n\n");
}

function buildRules(
	selectedTools: readonly string[],
	toolGuidelines: Readonly<Record<string, readonly string[]>>,
	promptGuidelines: readonly string[],
): string {
	const rules: string[] = [];
	const seen = new Set<string>();
	const addRule = (rule: string): void => {
		const normalized = rule.trim();
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		rules.push(normalized);
	};
	const hasBash = selectedTools.includes("bash");
	const hasPowerShell = selectedTools.includes("powershell");
	const hasGrep = selectedTools.includes("grep");
	const hasFind = selectedTools.includes("find");
	const hasLs = selectedTools.includes("ls");
	if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
		if (hasBash && hasPowerShell) addRule("Use bash or PowerShell for file operations like listing, searching, and finding files");
		else if (hasPowerShell) addRule("Use PowerShell for file operations like listing, searching, and finding files");
		else addRule("Use bash for file operations like ls, rg, find");
	}
	for (const name of selectedTools) for (const rule of toolGuidelines[name] ?? []) addRule(rule);
	for (const rule of promptGuidelines) addRule(rule);
	addRule("Be concise in your responses");
	addRule("Show file paths clearly when working with files");
	return rules.map((rule) => `- ${rule}`).join("\n");
}

/** Build the ordered, independently replaceable sections of the structured system prompt. */
export function buildSystemPromptSections(input: BuildSystemPromptInput): SystemPromptSections {
	const selectedTools = [...(input.selectedTools ?? ["read", "bash", "edit", "write"])];
	const hiddenTools = [...(input.hiddenTools ?? [])];
	const toolSnippets = { ...(input.toolSnippets ?? {}) };
	const toolGuidelines = { ...(input.toolGuidelines ?? {}) };
	const promptGuidelines = [...(input.promptGuidelines ?? [])];
	const appendSystemPrompt = input.appendSystemPrompt ?? "";
	const customSections = { ...(input.sections ?? {}) };
	const contextFiles = [...(input.contextFiles ?? [])];
	const skills = [...(input.skills ?? [])];

	for (const name of Object.keys(customSections)) {
		if (!SYSTEM_PROMPT_SECTION_NAME.test(name) || name === "preamble") {
			throw new Error(`Invalid system prompt section name: ${name}`);
		}
	}

	const declaredTools = selectedTools.filter((name) => !hiddenTools.includes(name));
	const promptSections: Record<string, string> = {};
	if (input.customPrompt) {
		promptSections.preamble = input.customPrompt;
	} else {
		promptSections.preamble =
			"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
		const visibleTools = declaredTools.filter((name) => !!toolSnippets[name]);
		const tools = visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n") : "(none)";
		promptSections.tools = `${tools}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`;
		promptSections.rules = buildRules(declaredTools, toolGuidelines, promptGuidelines);
		promptSections.docs = `Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${getReadmePath()}
- Additional docs: ${getDocsPath()}
- Examples: ${getExamplesPath()} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;
	}
	if (appendSystemPrompt) promptSections.addendum = appendSystemPrompt;
	if (contextFiles.length > 0) promptSections.project_context = renderProjectContext(contextFiles);
	const readers = ["read", "bash"] as const;
	const skillFileReadTool =
		readers.find((tool) => declaredTools.includes(tool)) ??
		(readers.some((tool) => selectedTools.includes(tool)) ? "indirect" : undefined);
	if (skillFileReadTool && skills.length > 0) {
		const skillsPrompt = formatSkillsForPrompt(skills, skillFileReadTool).trim();
		if (skillsPrompt) promptSections.skills = skillsPrompt;
	}
	promptSections.cwd = input.cwd.replace(/\\/g, "/");
	for (const [name, content] of Object.entries(customSections)) {
		if (content) promptSections[name] = content;
	}

	const sections: SystemPromptSections = { preamble: promptSections.preamble! };
	for (const [name, content] of Object.entries(promptSections)) {
		if (name !== "preamble") sections[name] = `<${name}>\n${content}\n</${name}>`;
	}
	return sections;
}

/** The system prompt text, rendered exactly as the transcript's system message replays it. */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
	return getSystemMessageText({ role: "system", content: "", sections: buildSystemPromptSections(input), timestamp: 0 });
}
