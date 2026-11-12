## 1. Spike (spec: `tui-parity`)

- [x] 1.1 Build an incomplete runtime whose every member records its use and returns a default. Verify `InteractiveMode.run()` starts and the log lists the members requested
- [x] 1.2 Run a prompt through the TUI against a durable session. Verify the log names the first member the runtime cannot satisfy

## 2. TUI artifact and mode (spec: `cli-prompt-modes`)

- [x] 2.1 Add `scripts/build-tui.mjs` that builds and loads the `pi-tui` native module for the host platform. Verify the helper resolves
- [x] 2.2 Select the TUI when stdout is a terminal with no mode and no prompt. Verify a terminal launch enters the TUI and `--mode rpc` does not

## 3. Session manager adapter (spec: `tui-parity`, `transcript-projection`)

- [x] 3.1 Serve `getEntries`, `getBranch`, `getTree`, and `buildContextEntries` from the durable projection. Verify they match `get_entries` for one session
- [x] 3.2 Serve the session identity members (`getSessionId`, `getSessionName`, `getSessionFile`, `getSessionDir`, `getCwd`, `isPersisted`, `usesDefaultSessionDir`). Verify the id that `get_state` reports
- [x] 3.3 Implement `appendCustomEntry` and `appendLabelChange` as durable commits. Verify a label change appends an entry

## 4. Agent session adapter (spec: `tui-parity`)

- [x] 4.1 Answer the state getters from durable. Verify each agrees with its RPC equivalent
- [x] 4.2 Map `prompt`, `steer`, `followUp`, `abort`, and `clearQueue` onto durable submissions. Verify a prompt round trip and an abort
- [x] 4.3 Apply `setModel`, `setThinkingLevel`, and `setScopedModels` to the durable agent. Verify a model change sticks
- [x] 4.4 Serve and update the tool surface through the registry. Verify a tool toggle reaches the model

## 5. Event synthesis (spec: `tui-parity`)

- [x] 5.1 Extend the projector to the `AgentSessionEvent` union. Verify a prompt produces the records the TUI renders, in order
- [x] 5.2 Emit the events durable does not model from their own sources. Verify a thinking-level change emits `thinking_level_changed`

## 6. Extension rendering (spec: `pi-extension-host`)

- [x] 6.1 Run pi's extension runner beside the durable host so renderers, overlays, and widgets register. Verify a fixture extension's tool row renders
- [x] 6.2 Keep execution on the durable host only. Verify a blocking `tool_call` hook runs once

## 7. Verification

- [x] 7.1 Add a TUI parity test that boots, prompts, renders a tool call, and opens a selector. Verify it passes
- [x] 7.2 Verify the README documents the TUI artifact and the dual extension runtime
