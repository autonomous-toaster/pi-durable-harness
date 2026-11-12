/**
 * The two expansions pi's `AgentSession.prompt` does before a prompt reaches the
 * model: `/skill:<name>` and `/<template>`. The durable host replaced that method,
 * so a typed `/commit` reached the model verbatim until this ran in its place.
 */

/** Split arguments the way pi does: bash-style quotes, opened only at a token start. */
export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let hasToken = false;
	let quote: string | undefined;
	let quoteStart = 0;
	for (let index = 0; index < argsString.length; index++) {
		const char = argsString[index] as string;
		if (quote !== undefined) {
			if (char === "\\" && argsString[index + 1] === quote) current += quote, index++;
			else if (char === quote) quote = undefined;
			else current += char;
		} else if ((char === '"' || char === "'") && !hasToken) {
			quote = char;
			quoteStart = index;
			hasToken = true;
		} else if (/\s/.test(char)) {
			if (hasToken) args.push(current), (current = ""), (hasToken = false);
		} else {
			current += char;
			hasToken = true;
		}
		if (quote !== undefined && index === argsString.length - 1) {
			// An unclosed quote stays literal: reopen the scan at the quote character.
			quote = undefined;
			current = argsString[quoteStart] as string;
			index = quoteStart;
		}
	}
	if (hasToken) args.push(current);
	return args;
}

/** Substitute `$ARGUMENTS`, `$1`, `${1}`, `${@:1:2}` and their defaults, as pi does. */
export function substituteArgs(content: string, args: readonly string[]): string {
	const all = args.join(" ");
	return content.replace(
		/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
		(_match, withDefault?: string, fallback?: string, sliceStart?: string, sliceLength?: string, simple?: string) => {
			if (withDefault !== undefined) {
				const value = withDefault === "@" || withDefault === "ARGUMENTS" ? all : args[Number(withDefault) - 1];
				return value === undefined || value === "" ? (fallback as string) : value;
			}
			if (sliceStart !== undefined) {
				const start = Math.max(0, Number(sliceStart) - 1);
				return sliceLength === undefined
					? args.slice(start).join(" ")
					: args.slice(start, start + Number(sliceLength)).join(" ");
			}
			if (simple === "ARGUMENTS" || simple === "@") return all;
			return args[Number(simple) - 1] ?? "";
		},
	);
}

/** Drop a leading `--- … ---` block, so a skill body is what the model reads. */
export function stripFrontmatter(text: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
	return match === null ? text : text.slice(match[0].length);
}

export interface SkillLike {
	readonly name: string;
	readonly filePath: string;
	readonly baseDir?: string;
}

export interface TemplateLike {
	readonly name: string;
	readonly content: string;
}

/** Expand `/skill:<name> args`, else return the text unchanged (as pi does). */
export function expandSkillCommand(text: string, skills: readonly SkillLike[], read: (path: string) => string): string {
	if (!text.startsWith("/skill:")) return text;
	const space = text.indexOf(" ");
	const name = space === -1 ? text.slice(7) : text.slice(7, space);
	const args = space === -1 ? "" : text.slice(space + 1).trim();
	const skill = skills.find((candidate) => candidate.name === name);
	if (skill === undefined) return text;
	let body: string;
	try {
		body = stripFrontmatter(read(skill.filePath)).trim();
	} catch {
		return text;
	}
	const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir ?? skill.filePath}.\n\n${body}\n</skill>`;
	return args === "" ? block : `${block}\n\n${args}`;
}

/** Expand `/<template> args`, else return the text unchanged (as pi does). */
export function expandPromptTemplate(text: string, templates: readonly TemplateLike[]): string {
	if (!text.startsWith("/")) return text;
	const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
	if (match === null) return text;
	const template = templates.find((candidate) => candidate.name === match[1]);
	if (template === undefined) return text;
	return substituteArgs(template.content, parseCommandArgs(match[2] ?? ""));
}
