## Context

See proposal.md — Why. `src/extensions/host.ts` translated pi's recorded declarations into durable tools and hooks, and classified every other surface as unhosted. The harness already reaches those surfaces through two seams it owns: `EventProjector` (durable `AgentEvent` → pi records) and the RPC dispatch in `src/rpc/session.ts`. pi itself resolves commands and emits session events at its session layer, not in its engine.

The loader's `pi` object resolves its shared `runtime` at call time (`loader.js`), so assigning implementations onto `loaded.runtime` after load makes `pi.*` actions work without pi's `ExtensionRunner`.

## Goals / Non-Goals

**Goals:**

- Dispatch every pi event that the harness has a seam for, in session order.
- Make the `pi.*` action surface functional against durable.
- Distinguish "accepted with no effect in RPC mode" from "no seam at all", and report only the latter.

**Non-Goals:**

- Provider-payload hooks (`before_provider_request`, `before_provider_headers`, `after_provider_response`, `provider_stream_event`). durable exposes the message list and the parsed message, not the payload or headers.
- A terminal: renderer registrations, shortcuts, `ui_prompt_*`, and `ctx.ui` stay inert.
- Applying `before_agent_start`'s `systemPrompt`/`message` results; they are reported.

## Decisions

**1. Dispatch from the projected stream, not from durable directly.**
`session.startEvents` already wraps the sink. Wrapping that sink once gives `agent_start`, `turn_*`, `message_*`, `tool_execution_*`, and `agent_settled` for free, in the exact order the client sees them. `compaction_end` maps to `session_compact`; `agent_before_settle` is dispatched immediately before the synthesized `agent_settled`.
Alternative rejected: durable task hooks for each event. It needs a hook per task name and duplicates the projector.

**2. Dispatch from the RPC commands the harness owns.**
`model_select` and `thinking_level_select` fire in the setters; `session_info_changed` in `setSessionName`; `user_bash` in `bash`; `session_tree` after a successful fork, clone, new, or switch; `input` in `submit`, where its `text` result replaces the message before skill expansion and command resolution.

**3. Serialize dispatch and contain throws.**
Handlers run through one promise chain, so an async handler never reorders events. A throw becomes a stderr diagnostic naming the extension and event; the run continues.

**4. Rebuild the action surface after load.**
`installActions` assigns the twelve engine-free-engine actions onto `loaded.runtime`. `installPreludeActions` installs `getSettings` and `getCommands` earlier, because a `resources_discover` handler may read them before the engine opens.
Alternative rejected: pi's `ExtensionRunner.bindCore`. It needs pi's `SessionManager` and `ModelRegistry`, which this harness deliberately does not use.

**5. A snapshot keeps `ctx.sessionManager` synchronous.**
pi's `sessionManager` is synchronous; durable is not. The bus refreshes a snapshot before each dispatch, and handlers read it without awaiting.

**6. Three classes.**
**Hosted** applies the surface. **Inert** accepts it with no effect, as pi does in RPC mode. **Unhosted** has no seam and is reported. A hosted handler result the harness cannot apply is reported too.

## Risks / Trade-offs

- [Extensions run user code in the event path] -> a throw is caught per handler and reported; the run continues.
- [A snapshot refresh adds a durable read per dispatch] -> refresh is one `entries()` and one `messages()` call, and a failure keeps the previous snapshot.
- [Assigning onto the loader's runtime is undocumentable API] -> it is guarded by tests that assert each action's durable effect, so a pi change that breaks it fails loudly.
- [Inert now hides a surface a user wanted] -> inert is limited to surfaces pi itself cannot honor in RPC mode; everything else is still reported.
