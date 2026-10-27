## Context

See proposal.md - Why. The harness reuses pi's own loaders (`DefaultResourceLoader`, `ModelRuntime`, `SettingsManager`) but runs durable's engine, not pi's agent core. Today `src/index.ts` forces `noExtensions: true`, `src/rpc/session.ts` returns `{ commands: [] }` from `getCommands()`, and skills reach the model only through `formatSkillsForPrompt`. The dependency pin is `1.1.0`.

Verified compatibility surface between pi `1.1.0` and `1.4.0` (both inspected from the published tarballs):

- `docs/rpc.md`, `docs/rpc-commands.md`, `docs/json.md` are byte-identical.
- The RPC command set is identical.
- `DefaultResourceLoaderOptions` (`noExtensions`, `extensionsOverride`, `skillsOverride`, `skillsOverride`), `getSkills()`, `loadSkills`, `formatSkillsForPrompt`, and `Skill.disableModelInvocation` are unchanged.
- `dist/index.d.ts` adds three exports and removes none.
- durable's `Extension`, `HookRegistration`, and `ToolRegistration` shapes are unchanged.

pi's `ExtensionAPI` exposes 41 `on(...)` events plus `registerTool`, `registerCommand`, `registerProvider`, and `ctx.ui.*`. durable's `Extension` exposes `tools`, `sections`, `hooks`, `wraps`, and `tasks` only. The gap is not one wall: it splits by **layer**.

- **Engine layer** (durable): hosts tools, prompt sections, task hooks, and arbitrary custom tasks. It does not model commands, providers, or session lifecycle.
- **Harness layer** (this project's wrapper): owns `ModelRuntime`, the RPC command dispatch, and the session commands (`fork`, `switch_session`). pi resolves commands and emits the session-lifecycle events at *its own* session layer, not in its engine.

So a pi extension surface that durable lacks is hostable by the wrapper. `registerProvider` is proven: pi calls `modelRuntime.registerProvider(name, config)` (`core/agent-session.js`), and the harness already holds that exact `ModelRuntime` (`src/index.ts`). Commands and session vetoes are also harness-layer work: pi resolves `/name` at its input layer (`_tryExecuteExtensionCommand`, `core/agent-session.js`) and emits the session-lifecycle events from its session layer, and this harness owns the equivalent seams — `prompt` dispatch in `src/rpc/server.ts` and `new_session`/`switch_session`/`fork`/`clone`/`compact` in `src/rpc/session.ts`.

## Goals / Non-Goals

**Goals:**

- Re-baseline the pin and the golden fixtures on pi 1.4.0 with no wire changes.
- Return skills, templates, and extension commands from `get_commands` with pi's shape, and expand `/skill:<name>` messages before the model call.
- Load pi extensions and host every surface the engine and the wrapper can faithfully express: tools, sections, hooks, providers, commands, and the session-lifecycle vetoes.
- Report the one surface the harness does not host (`ctx.ui.*`) with a loud diagnostic, never a silent no-op.

**Non-Goals:**

- The `extension_ui_request` / `extension_ui_response` sub-protocol.

## Decisions

**1. Bump all six pins to 1.4.0 and re-capture the fixtures.**
Why: the wire surface is proven identical, so the bump is mechanical. Re-capturing is what makes the parity claim true again. Their fixtures directory is renamed `test/fixtures/pi-1.1.0` -> `test/fixtures/pi-1.4.0`.
Alternative rejected: stay on 1.1.0. It keeps the claim honest only by keeping the harness obsolete.

**2. Skills are implemented on the RPC surface, not the engine.**
`get_commands` reads the loaded `Skill[]` from the resource loader and maps each to `{ name: "skill:<name>", description, source: "skill", sourceInfo }`. Skill expansion belongs where pi puts it: input expansion before send/queue, so it sits in prompt handling (`src/harness/oneshot.ts` and the RPC `prompt` path via a shared helper).
Alternative rejected: a durable tool that reads `SKILL.md`. pi does not model skills as tools; it prepends their text to the user message.

**3. Extensions are translated with an explicit capability classifier.**
The resource loader already runs each `ExtensionFactory` against pi's own `ExtensionAPI`, which records declarations into plain maps (`tools`, `handlers`, `commands`, `flags`, `shortcuts`) and queues provider registrations. The translator reads those maps; it does not re-run the factory against a hand-written shim. Each hosted surface maps to one durable or harness primitive:

| pi surface | host |
| --- | --- |
| `registerTool` | durable `tools` |
| `context`, `context_with_system` | `GenerationHooks.beforeRequest` (message list) |
| `tool_call` | `ToolHooks.beforeTool` (block or rewrite arguments) |
| `tool_result` | `ToolHooks.afterTool` (replace the result) |
| `session_before_compact` | `CompactionHooks.beforeCompact` (decline) |
| `registerProvider` | `ModelRuntime.registerProvider` (harness layer) |
| `registerCommand` | harness command registry + `prompt` resolution |
| `session_before_fork` / `_switch` / `_tree` | harness veto consult in `src/rpc/session.ts` |

`context` and `context_with_system` edit the **message list**, not a prompt section, so both map to `beforeRequest`. `before_provider_request` carries a provider `payload` and `after_provider_response` carries a `status` and `headers`; durable exposes only the message list and the parsed message, so neither has an equivalent and both are classified unsupported. The observation-only events (`agent_start`, `agent_end`, `session_start`, `turn_start`, `message_*`, `tool_execution_*`, `model_select`, ...), the renderer registrations, flags, shortcuts, and `ctx.ui.*` are also unsupported, because the harness does not dispatch them to extensions. Each one is reported by name.
Alternative rejected: a hand-written `ExtensionAPI` shim. pi's loader already records every declaration, so a shim would duplicate it and drift.
Alternative rejected: routing every surface durable lacks through one "refuse" bucket. Source inspection shows the wrapper hosts commands and vetoes at the same layer pi does, so a refuse bucket would misreport them.

**4. Harness-layer seams host commands and vetoes.**
Commands: the translator registers each command in a harness command registry. The `prompt` handler resolves a `/name` message against the registry before dispatch, runs the handler, and answers `disposition: "handled"` with no model run, as pi does. The same registry feeds `get_commands`.
Vetoes: `new_session`, `switch_session`, `fork`, `clone`, and `compact` consult the extension handlers before acting and honor `{ cancel: true }`. The consult runs **before** the change captures state, so a veto leaves the session unchanged.
Alternative rejected: a durable task per command. It adds engine surface and ordering risk for no behavior the registry does not already provide.

**5. Unsupported surfaces produce a diagnostic, not a no-op.**
`ctx.ui.*` and the events with no durable or harness counterpart record a diagnostic. After the loader finishes, the harness writes one stderr line per unsupported surface naming the extension path and the surface, then installs the extension with its hosted parts.
Alternative rejected: hard-fail the process. A single unsupported call in an otherwise useful extension should not stop the session; pi itself degrades many UI methods in RPC mode.
Alternative rejected: silent no-op. A silent no-op hides the gap and corrupts the compatibility claim.

**6. `configure` the `durable-rpc: ` prefix for diagnostics.**
Existing warnings already use `durable-rpc: ` on stderr, so extension diagnostics reuse that prefix to stay consistent with the RPC contract (diagnostics on stderr, never stdout).

## Risks / Trade-offs

- [Pin drift as pi releases 1.5.0+] -> the fixture re-capture is a repeatable tool (`tools/capture-fixtures.mjs`); treat the pin bump as a routine change.
- [A hosted-looking extension diverges because a hook is absent] -> classify strictly and log every unmapped event name.
- [A veto runs after state is captured] -> the design fixes the order: consult, then capture; cover with a test that asserts a cancelled fork changes nothing.
- [`context` semantics differ between pi and durable's `beforeRequest`] -> cover with a conformance test that asserts the edited message list reaches the mock model.
- [Extension loading changes the prompt for existing users] -> loading is additive; an absent extension directory changes nothing.

## Open Questions

- Whether a command handler that needs model work should run through a synthetic prompt or a durable task. Either is internal to `src/extensions/` and does not change this change's specs or tasks.