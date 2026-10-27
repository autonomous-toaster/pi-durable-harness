/**
 * Skills as RPC commands (tasks 2.1-2.4).
 *
 * pi lists every loaded skill as a `skill:<name>` command and expands a
 * `/skill:<name> <args>` message into the skill's `SKILL.md` body before the
 * model call. This module keeps the listing and the expansion on the harness
 * side, because durable has no skill concept; the resource loader supplies the
 * skills and their files.
 */
import { readFileSync } from "node:fs";
import { stripFrontmatter, type Skill } from "@earendil-works/pi-coding-agent";
/** One entry of pi's `get_commands` payload. */
export interface RpcCommandInfo {
	readonly name: string;
	readonly description: string;
	readonly source: "extension" | "prompt" | "skill";
	readonly sourceInfo: unknown;
}

/** List every loaded skill as a `skill:<name>` command, as pi does (tasks 2.1, 2.2). */
export function skillCommands(skills: readonly Skill[]): RpcCommandInfo[] {
	return skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill" as const,
		sourceInfo: skill.sourceInfo,
	}));
}

/**
 * Expand a `/skill:<name> <args>` message into the skill body (task 2.3).
 * A message that is not a skill command, or names an unknown skill, passes
 * through unchanged. A skill whose file cannot be read also passes through.
 */
export function expandSkillCommand(text: string, skills: readonly Skill[]): string {
	if (!text.startsWith("/skill:")) return text;
	const spaceIndex = text.indexOf(" ");
	const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
	const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
	const skill = skills.find((candidate) => candidate.name === skillName);
	if (skill === undefined) return text;
	try {
		const body = stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim();
		const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
		return args ? `${block}\n\n${args}` : block;
	} catch {
		return text;
	}
}
