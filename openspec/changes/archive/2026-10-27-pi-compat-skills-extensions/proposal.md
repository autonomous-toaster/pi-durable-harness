# pi Compatibility: Pinned Bump, Skills, and Extensions

## Why

The harness is pinned to pi **1.1.0** while the current release is **1.4.0**, so its "matched to pinned pi" claim is only true for an obsolete pi. Two capabilities pi clients rely on are also missing or stubbed: **skills** reach the model only as names and descriptions (no `/skill:name` invocation, no `get_commands` listing), and pi **extensions** are excluded outright (`noExtensions: true`). The stated goal is a 100% drop-in for `pi --mode rpc`; a client that installs a skill or an extension cannot currently get pi's behavior.

## What Changes

- Bump every `@earendil-works/*` dependency from `1.1.0` to `1.4.0` and re-capture the golden pi RPC fixtures from pi 1.4.0, so the parity claim matches the pinned version again. The RPC wire surface is unchanged (`rpc.md`, `rpc-commands.md`, `json.md` are byte-identical; `index.d.ts` adds three exports and removes none), so this is a mechanical re-baseline.
- **Skills (phase 1)**: return skills, prompt templates, and extension commands from `get_commands` with pi's `SlashCommandInfo` shape; expand `/skill:<name> <args>` on the `prompt` command by loading the skill's `SKILL.md` and appending the arguments; respect `disable-model-invocation` so a skill stays invocable by command while hidden from model selection.
- **Extensions (phase 2)**: load pi extensions with `DefaultResourceLoader` and translate each `ExtensionFactory` into a durable `Extension`. Support the subset the engine and the harness can faithfully host — **tools**, **prompt sections written through `context`/`context_with_system`**, **pure hook points** (`tool_call`/`tool_result`, `before_provider_request`/`after_provider_response`, `session_before_compact`), and **provider registration** (`registerProvider` forwards to the `ModelRuntime` the harness already holds).
- **Command extension point (phase 2)**: keep a harness-layer command registry and resolve a `/name` message on the `prompt` command before dispatch, as pi does at its input layer. A resolved command runs through the harness and reports `disposition: "handled"` with no model run. The command set also feeds the `get_commands` response.
- **Session-lifecycle vetoes (phase 2)**: consult the extension handlers for `session_before_switch`, `session_before_fork`, `session_before_tree`, and `session_before_compact` at the harness's own session commands (`new_session`, `switch_session`, `fork`, `clone`, `compact`), and honor a `{ cancel: true }` result. These call sites already live in `src/rpc/session.ts` and `src/rpc/server.ts`, so no engine change is needed.
- **Supported-with-limits (phase 2)**: `ctx.ui.*` is not hostable, because the RPC extension UI request/response sub-protocol is out of scope; each call is reported through a loud diagnostic. This matches pi, which degrades most UI methods in RPC mode.

**BREAKING** for the claim "extension packages are out of scope": they are now in scope, as a documented subset.

Explicit non-goal for this change: the `extension_ui_request`/`response` sub-protocol and the pi-RPC extension UI records.

## Capabilities

### New Capabilities

- `pi-extension-host`: the pi→durable extension translator, the hosted-capability subset, provider registration forwarding, the command registry, the session-lifecycle veto points, and the loud diagnostic for the UI subset.
- `failure-diagnostics`: a non-fatal diagnostic channel that reports degraded extensions and unsupported surfaces on stderr without ending a run.

### Modified Capabilities

- `harness-tooling-parity`: skill handling changes from "names and descriptions in the prompt" to full command listing and `/skill:name` invocation, and extensions change from excluded to supported-as-a-subset.
- `rpc-parity`: `get_commands` changes from a fixed empty list to the configured command set, and `prompt` gains skill-command expansion.
- `cli-prompt-modes`: the `durable-rpc` startup contract gains the pinned-version check and the degraded-extension diagnostic.

## Impact

- **Code**: bump `package.json`/`package-lock.json`; add a skill-command module and wire `src/rpc/session.ts::getCommands()` and `src/harness/oneshot.ts`/`prompt` dispatch; add `src/extensions/` (translator, capability classification, provider forwarding, command registry, session veto consult points); change `src/index.ts` to load extensions instead of forcing `noExtensions: true`; change `src/harness/engine.ts` to install translated extensions; change `src/rpc/session.ts` and `src/rpc/server.ts` to consult session vetoes and resolve commands.
- **Dependencies**: `@earendil-works/*` `1.1.0` → `1.4.0`; no new packages.
- **Verification**: re-capture `test/fixtures/pi-1.1.0/` as `test/fixtures/pi-1.4.0/`; add conformance tests for skill listing and `/skill:` expansion, for one hosted extension surface, and for a command and a session veto.
- **Risk**: pinning is a moving target; a surface the harness does not host must produce a named diagnostic rather than a silent no-op.
- **Sequencing**: the veto consult points have ordering semantics (a veto runs before the fork state is captured). The design records the required order.