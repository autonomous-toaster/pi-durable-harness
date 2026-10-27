## 1. Pinned version (spec: `harness-tooling-parity`)

- [x] 1.1 Pin every `@earendil-works/*` dependency to `1.4.0` and verify `package-lock.json` resolves each one to `1.4.0`
- [x] 1.2 Run `npm install`, `npm run typecheck`, and `npm run build` and verify each command exits 0
- [x] 1.3 Re-capture the golden RPC fixtures from pi 1.4.0 into `test/fixtures/pi-1.4.0/` and verify the capture script exits 0
- [x] 1.4 Re-run the fixture diff against the re-baselined corpus and verify no unexpected event name or field remains

## 2. Skills (spec: `rpc-parity`, `harness-tooling-parity`)

- [x] 2.1 Read the loaded skills, prompt templates, and commands from the resource loader and verify a listing test sees each loaded skill
- [x] 2.2 Map each listing entry to pi's command shape and return it from `get_commands`, and verify a test compares the response to a pi 1.4.0 fixture
- [x] 2.3 Expand a `/skill:<name> <args>` message before the model call and verify the loaded `SKILL.md` text and the arguments reach the prompt
- [x] 2.4 Keep a `disable-model-invocation` skill invocable by command and omit it from model selection, and verify both behaviors in one test

## 3. Extensions (spec: `pi-extension-host`, `failure-diagnostics`, `harness-tooling-parity`, `rpc-parity`)

- [x] 3.1 Load extensions through the resource loader and verify a fixture extension factory runs once at startup
- [x] 3.2 Translate each `registerTool` call into a durable tool and verify the tool appears in the declared set
- [x] 3.3 Translate each `context` and `context_with_system` handler into a `beforeRequest` hook and verify the edited message list reaches the model
- [x] 3.4 Map each hosted lifecycle event to a durable hook and verify a `tool_call` handler blocks a tool call
- [x] 3.5 Classify each extension capability as hosted or unsupported and verify the classifier labels a fixture extension with a UI call as unsupported
- [x] 3.6 Report each unsupported surface on stderr with the extension path and the surface, and verify the line appears and the run continues
- [x] 3.7 Install each translated extension into the engine registry and verify a hosted fixture extension applies its tool and hooks
- [x] 3.8 Forward each `registerProvider` call to the model runtime and verify the provider appears in the available models
- [x] 3.9 Register each extension command in the harness command registry and verify the command appears in the `get_commands` response
- [x] 3.10 Resolve a `/name` message against the command registry on `prompt` and verify the handler runs and the response reports `handled` with no model run
- [x] 3.11 Consult the session-lifecycle handlers at `new_session`, `switch_session`, `fork`, `clone`, and `compact` before the change captures state, and verify a `{ cancel: true }` handler leaves the session unchanged

## 4. Verification (specs: all)

- [x] 4.1 Add the skill conformance test and verify `npm run check` passes with it
- [x] 4.2 Add the extension conformance test, covering the hosted surfaces and a command and a session veto, and verify `npm run check` passes with it
- [x] 4.3 Run `node tools/acceptance.mjs` against the harness and verify it terminates at quiescence with no unexpected record