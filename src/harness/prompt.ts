/**
 * pi's system prompt as one durable extension (task 8.2). Project instructions
 * (AGENTS.md) and skills come from coding-agent's resource loader, so the same
 * files pi loads are what the model sees.
 */
import type { PromptInput, ToolRegistration } from "@earendil-works/pi-durable";
import { defineExtension, section } from "@earendil-works/pi-durable";
import { formatSkillsForPrompt, type Skill } from "@earendil-works/pi-coding-agent";

export interface PromptResources {
	readonly agentsFiles: readonly { readonly path: string; readonly content: string }[];
	readonly skills: readonly Skill[];
	readonly systemPrompt?: string | undefined;
	readonly appendSystemPrompt: readonly string[];
}

const PREAMBLE = "You are a coding agent. Use the tools to inspect and change the project.";

function renderAgents(files: PromptResources["agentsFiles"]): string | undefined {
	if (files.length === 0) return undefined;
	return files.map((file) => `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`).join("\n\n");
}

function renderSkills(skills: readonly Skill[]): string | undefined {
	if (skills.length === 0) return undefined;
	return formatSkillsForPrompt([...skills]);
}

function renderSystemPrompt(resources: PromptResources): string | undefined {
	const parts = [resources.systemPrompt, ...resources.appendSystemPrompt].filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	return parts.length === 0 ? undefined : parts.join("\n\n");
}

/** Build the prompt extension from resources loaded once at startup. */
export function createPromptExtension(resources: PromptResources) {
	const sections = [
		section("preamble", () => PREAMBLE, { tag: false }),
		section("system", () => renderSystemPrompt(resources)),
		section("project_context", () => renderAgents(resources.agentsFiles)),
		section("skills", () => renderSkills(resources.skills)),
		section("cwd", (input: PromptInput<ToolRegistration>) => input.env?.cwd ?? input.agent.cwd),
	];
	return defineExtension({ name: "harness.prompt", sections });
}
