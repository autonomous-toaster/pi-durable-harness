## Why

The harness is headless by design: `README.md` says *"There is no interactive TUI: a terminal client uses RPC mode."* A user who wants pi's terminal experience has to run `pi` itself, and everything durable buys — crash-resume, tenant-scoped sessions, PostgreSQL storage — is unavailable in that mode.

Pixel-for-pixel parity means running **pi's own `InteractiveMode`** unchanged. It is a public export (`new InteractiveMode(runtimeHost, options).run()`), so parity of every row, selector, keybinding, and slash command is free. What is missing is the `AgentSessionRuntime` it drives: pi's `AgentSession`, `SessionManager`, and `AgentSessionServices`, which this project replaces with durable.

**BREAKING** for the claim "the harness has no interactive mode": it gains a TUI mode.

## What Changes

- A durable-backed `AgentSessionRuntime` adapter: `AgentSession` (≈40 members the TUI actually calls), `SessionManager` (17 members, served from the existing pi-shaped projection), and the services fields, handed to pi's `InteractiveMode` with narrow casts because pi's classes carry private members.
- `AgentSessionEvent` synthesis: the RPC projector grows into the richer pi union, including events durable does not model (`summarization_retry_*`, `session_info_changed`, `thinking_level_changed`, `bash_execution_update`) fed from their durable sources.
- A TUI mode selected when stdout is a terminal and no mode or prompt is given.
- pi's `ExtensionRunner` runs beside the durable extension host, so extension-provided rows, overlays, and widgets render. Execution stays on durable; the runner renders.
- A **fourth artifact**: `pi-tui` loads a per-platform native module, so the TUI build ships that module beside its entry and the ESM package, single-file bundle, and SEA binary stay TUI-free.
- A spike first: an incomplete runtime that records every member the TUI asks for, so the adapter's real surface is measured rather than assumed.

## Capabilities

### New Capabilities

- `tui-parity`: the durable-backed runtime pi's `InteractiveMode` drives — its session, session manager, state getters, loop operations, model and tool operations, event records, and the parity test.

### Modified Capabilities

- `cli-prompt-modes`: a terminal launch selects the TUI, and the TUI artifact ships the native module beside its entry.
- `pi-extension-host`: pi's extension runner also runs for rendering, while execution stays on the durable host.
- `transcript-projection`: the projection serves the TUI's entry tree and context entries, not only `get_entries`.

## Impact

- **Code**: `src/harness/tui/runtime.ts` (the adapter), `src/harness/tui/session-manager.ts`, `src/harness/tui/events.ts` (extending `src/harness/events.ts`), `src/harness/tui/entry.ts` (`new InteractiveMode(...).run()`), `src/index.ts` (mode selection), `scripts/build-tui.mjs`, `src/harness/projection.ts` (tree and context entries), `src/extensions/host.ts` (the rendering runner).
- **Dependencies**: `@earendil-works/pi-tui` as a direct dependency. Its native prebuild means the TUI build cannot be the single-file artifact.
- **Verification**: the spike log; a parity test that boots, prompts, renders a tool call and opens a selector; a label-change commit; and a check that a blocking `tool_call` hook runs once.
- **Risk**: the adapter is three structural fakes passed with `as unknown as`. TypeScript stops checking, and pi's next minor release can change a signature silently. The pin and a conformance test are the only guards.
- **Risk**: two extension runtimes see one session. Rendering and execution can disagree, for example when a hook blocks a call the TUI already drew.
- **Risk**: pi's event union includes events with no durable analogue. Some will be synthesised approximately, and a few will not be emitted at all until their source exists.
