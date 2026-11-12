/**
 * Copy one session into another (task: `--fork`).
 *
 * pi forks a session into a new one in the current directory, so the target is a
 * different storage in our model: durable has no cross-storage conversation
 * copy, and this is that copy. Entries are replayed in order, keeping their
 * kind, model messages, data and context edits; an entry that started a new
 * active context keeps doing so through `head: "self"`. The agent's model and
 * thinking level are carried over, so the fork continues where the source was.
 *
 * The copy is one commit on the target, so a fork is either the whole transcript
 * or nothing.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness, type Storage } from "@earendil-works/pi-durable";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const CONTEXT = BACKGROUND_CONTEXT;

export interface ForkResult {
	readonly entries: number;
	readonly model?: { readonly provider: string; readonly modelId: string };
}

/** Replay `source`'s transcript and agent into `target`. */
export async function copySession(source: Storage, target: Storage, models: ModelRuntime): Promise<ForkResult> {
	const sourceHarness = await Harness.open(source, { models, registry: createRegistry() }, CONTEXT);
	let entries: Awaited<ReturnType<Awaited<ReturnType<typeof sourceHarness.root>>["entries"]>>["items"];
	let agent: Awaited<ReturnType<Awaited<ReturnType<typeof sourceHarness.root>>["agent"]>>;
	try {
		const conversation = await sourceHarness.root(CONTEXT);
		entries = (await conversation.entries({ order: "ascending" }, Number.MAX_SAFE_INTEGER, undefined, CONTEXT)).items;
		agent = await conversation.agent(CONTEXT);
	} finally {
		await sourceHarness.close(CONTEXT).catch(() => {});
	}

	const targetHarness = await Harness.open(target, { models, registry: createRegistry() }, CONTEXT);
	try {
		const conversation = await targetHarness.root(CONTEXT);
		// The source's model, as the agent document holds it.
		const model = agent.model === undefined ? undefined : { provider: agent.model.provider, modelId: agent.model.modelId };
		await conversation.commit(async (tx) => {
			for (const entry of entries) {
				await tx.appendEntry(conversation.id, {
					kind: entry.kind,
					...(entry.model === undefined ? {} : { model: entry.model }),
					...(entry.data === undefined ? {} : { data: entry.data }),
					...(entry.edits === undefined ? {} : { edits: entry.edits }),
					// A head marker keeps selecting a new active context at itself.
					...(entry.head === undefined ? {} : { head: "self" as const }),
				});
			}
		}, CONTEXT);
		if (model !== undefined) {
			await conversation.configure(
				{
					model,
					...(agent.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }),
				},
				CONTEXT,
			);
		}
		return { entries: entries.length, ...(model === undefined ? {} : { model }) };
	} finally {
		await targetHarness.close(CONTEXT).catch(() => {});
	}
}
