## Context

See proposal.md - Why. Pixel parity is achievable because pi's `InteractiveMode` is a public export with a one-line entry point:

```ts
export declare class InteractiveMode {
  constructor(runtimeHost: AgentSessionRuntime, options?: InteractiveModeOptions);
  run(): Promise<void>;
}
```

The surface was measured from the TUI's own calls rather than from the class declarations:

- `session.*` — about 40 distinct members: `prompt`, `steer`, `abort`, `state`, `messages`, `isStreaming`, `isIdle`, `isCompacting`, `isBashRunning`, `model`, `routedModel`, `thinkingLevel`, `setModel`, `setThinkingLevel`, `getAvailableThinkingLevels`, `scopedModels`, `setScopedModels`, `promptTemplates`, `extensionRunner`, `modelRuntime`, `resourceLoader`, `settingsManager`, `agent`, `sessionFile`, `sessionManager`, `retryAttempt`, `autoCompactionEnabled`, `getContextUsage`, `rename`, `navigateTree`, and the session-list fields.
- `sessionManager.*` — exactly these 17: `getSessionId`, `getSessionName`, `getSessionFile`, `getSessionDir`, `getCwd`, `getEntries`, `getEntryCount`, `getBranch`, `getTree`, `getLeafId`, `appendCustomEntry`, `appendLabelChange`, `buildContextEntries`, `isPersisted`, `usesDefaultSessionDir`.
- `services` — `extensionRunner`, `modelRuntime`, `settingsManager`, `resourceLoader`.
- plus `AgentSessionEvent`, the union durable deleted in 1.5.0.

Two facts close the shortcuts. `createAgentSession(options)` takes no `sessionManager`, and `SessionManager`'s constructor is private, so pi's own loop cannot be pointed at durable storage. And `AgentSession`, `SessionManager`, and `AgentSessionRuntime` carry private members, so an adapter does not structurally type-check and must be passed with a cast.

## Goals / Non-Goals

**Goals:**

- Run pi's `InteractiveMode` unmodified, so every row, selector, keybinding, and slash command is pi's.
- Make the adapter's required surface a measured list before writing it.

**Non-Goals:**

- Reusing pi's agent loop. It cannot be given a durable session store.
- A TUI inside the SEA or single-file bundle: the native `pi-tui` module forbids it.
- Emitting an event durable has no source for. Each is named in the design rather than faked silently.

## Decisions

**1. Fake the three classes and pass them with a cast.** `new InteractiveMode(runtimeHost).run()` needs an `AgentSessionRuntime`. Implementing it structurally is the only way to keep pi's TUI; the casts are the price, and a conformance test plus the exact pin are the guards. Alternative: vendor pi's interactive tree into this repo — then the types line up, but 18k lines become ours to merge on every pi release.

**2. Measure before writing: the spike.** An incomplete runtime whose every member records its use and returns a plausible default. Booting the TUI against it turns "about 40 members" into the exact list, and surfaces the first hard gap. Alternative: implement from the `.d.ts` — it lists more than the TUI calls and hides which of them the TUI depends on for rendering.

**3. `SessionManager` is served from the existing projection.** `projection.ts` already emits pi `SessionEntry` shapes for `get_entries`; `getEntries`, `getBranch`, `getTree`, and `buildContextEntries` extend that with the tree and the active context. `isPersisted` is true, `getSessionFile` returns null and `usesDefaultSessionDir` false, so the TUI's session panels say a session exists without claiming a pi file.

**4. `AgentSession` splits into state and loop.** State getters read durable (`state`, `messages`, `isStreaming`, `isIdle`, `isCompacting`, `retryAttempt`, `getContextUsage`). Loop operations submit through durable (`prompt`, `steer`, `followUp`, `abort`, `clearQueue`) using the same engine calls the RPC commands use. Model and tool operations go through the engine's configure and the registry, so the TUI cannot drift from RPC.

**5. Events grow from the RPC projector.** `src/harness/events.ts` already turns state revisions into pi records; the richer `AgentSessionEvent` union is a second rendering of the same revisions, with `entry_appended` carrying pi `SessionEntry`. Events durable has no source for are emitted from the nearest durable fact and named in the design: `thinking_level_changed` and `session_info_changed` from their control entries, `bash_execution_update` from the bash command, `summarization_retry_*` only when a summarization retry exists.

**6. pi's extension runner renders, the durable host executes.** The TUI reads `session.extensionRunner` for tool rows, message renderers, overlays, and widgets. Running pi's runner beside our translator gives the TUI its components. The rule is one-directional: the runner renders and never executes, because a hook that ran twice would double-block or double-commit.

**7. The TUI is a fourth artifact, and it is not single-file.** `pi-tui` resolves `native/<platform>/prebuilds/…-platform.node` from its own package path, its `dist`, or beside the executing binary — never from our entry. So a TUI build requires the installed package tree; `scripts/build-tui.mjs` builds `dist/` and loads the platform helper to prove it resolves, and the ESM package, single-file bundle, and SEA binary stay TUI-free.

**8. A terminal selects the TUI.** `stdout.isTTY` and no `--mode` and no prompt selects it; `--mode rpc` always wins, so a client that pipes stdio never gets a renderer.

## Risks / Trade-offs

- **Cast-based adapter, no compile-time contract.** → The pin is exact and `npm run check` plus the parity test are the gate; a pi upgrade that changes a signature fails at runtime, so the parity test must cover every member the spike recorded.
- **Two extension runtimes, one session.** → The runner never executes; a hook that blocks is executed once, on the durable host, and the TUI draws the result.
- **Events without a durable source.** → Named in Decision 5; anything without a source is omitted and listed, not invented.
- **Native module packaging.** → A fourth artifact; the three headless ones are untouched, and the TUI build is not advertised as portable.
- **Session-file semantics in a fileless store.** → `getSessionFile` null, `isPersisted` true, `usesDefaultSessionDir` false; the `/session` panel shows identity instead of a path.

## Migration Plan

Additive: a new artifact and a new mode. Existing RPC clients are unaffected because `--mode rpc` keeps precedence and a piped stdin is never a TTY. Nothing to migrate; deleting `dist/tui/` removes the feature.

## Open Questions

Whether the TUI should also be reachable as an explicit `--mode tui` flag can be settled during implementation without changing the specs: the requirement only fixes what a terminal launch does when no mode is named.
