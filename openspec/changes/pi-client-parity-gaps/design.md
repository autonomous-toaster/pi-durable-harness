## Context

See proposal.md - Why. Two facts shape the approach.

**Argument parsing.** `src/harness/config.ts` keeps a `VALUE_FLAGS` table (9 entries) and treats every other `-`-prefixed token as a boolean flag. The next token after an unknown flag therefore becomes a positional prompt. `interfaceName` is `prompts.length === 0 ? "rpc" : mode === "json" ? "json" : "print"`, and `src/index.ts:176` serves one-shot when `interfaceName !== "rpc"`. pi 1.5.2 parses **15** flags with a value; the harness knows 9. `--system-prompt` and the repeatable `--append-system-prompt` accept text *or* the path of an existing file.

**Extension UI.** `src/extensions/host.ts` gives every extension `{ cwd, ui: inertUi() }` with no `hasUI`, so an extension's ask tool takes its non-interactive branch. pi's protocol is documented and already parsed by Open WebUI: requests are `{type:"extension_ui_request", id, method, title, …}`; responses are `{type:"extension_ui_response", id, value|confirmed|cancelled}`; `select`/`confirm`/`input`/`editor` may carry a `timeout` after which the agent resolves `undefined`.

## Goals / Non-Goals

**Goals:**

- Make an explicit `--mode rpc` immune to any argument the harness does not understand.
- Reach argv parity with pi 1.5.2 for every flag that takes a value.
- Host the four dialog methods with pi's exact envelope, so an existing client adapter works unchanged.

**Non-Goals:**

- Importing pi's CLI parser. It is not a supported export, and the harness already avoids unsupported imports except for the codemode description composer.
- Parking a tool call before it runs (durable 1.5.2 has no signal/park API). Dialogs are raised *inside* a running tool.
- Surviving a client reconnect or a process restart with a dialog open.
- `notify`/`setStatus`/`setWidget`/`setTitle`/`set_editor_text`. They are fire-and-forget presentation calls; the inert implementation stays.

## Decisions

**1. Mirror pi's arity table; do not probe for values.** A boolean flag followed by a prompt is indistinguishable from a value flag followed by its value, so guessing is unsound. The table lists each flag pi parses with a value; unknown flags stay boolean and never consume the next token.

**2. An explicit RPC mode never yields to a positional argument.** Independent of the table, `--mode rpc` keeps `interfaceName === "rpc"` and reports a stray token on stderr. This is the guard that turns future table drift into a warning instead of a silent mode switch, and it is why the Open Terminal path cannot regress the same way twice.

**3. A flag value is a path only when the path exists.** pi documents `<text|path>`; resolving by existence keeps a literal string that happens to look like a filename usable. Resolution is per occurrence, so `--append-system-prompt` can mix text and files.

**4. The flags layer over the resource loader, they do not replace it.** `--system-prompt` becomes `customPrompt` (which `buildSystemPromptSections` already honours by skipping the default preamble); `--append-system-prompt` occurrences append to whatever `loader.getAppendSystemPrompt()` already produced, in argv order. Alternatives: last-wins (loses the loader's value) and replace-all (surprising for a flag named "append").

**5. The dialog envelope is pi's, verbatim.** `{type:"extension_ui_request", id, method, title, message?, options?, prefill?, placeholder?, timeout?}` out; a response is matched by `id`. Reusing pi's shape is the whole point: Open WebUI's adapter already maps it onto its approve and ask dialogs, so parity is free and a bespoke envelope would be a second protocol to maintain.

**6. The pending map lives in the RPC server, not in durable state.** A dialog is a property of the live connection: `ctx.ui.confirm` awaits a promise held in a `Map<id, deferred>`. This is the decision that makes reconnect unsupported — see Risks. Durable state would make the dialog survive a reconnect, but it also makes a pending question an element of the transcript, which is a different and much larger contract.

**7. `hasUI` is true exactly when a client can answer.** In RPC mode a client is attached by definition, so `hasUI` is true and the four dialog methods route to it. In print/json modes no client answers, so the existing inert UI stays and `hasUI` is absent. An extension therefore keeps one code path and one fallback.

**8. Every pending dialog settles, and the map is bounded.** Abort of the owning run, stdin close, and shutdown each settle every pending dialog with `{cancelled: true}`; an entry also honours its own `timeout`. Nothing is left awaiting, so a stalled or departed client cannot pin a tool call open.

**9. Extension MCP servers join the same connection set as `mcp.json`.** Union by name; an extension registration shadows an `mcp.json` entry of the same name because it is the more specific, code-level declaration, and the shadowing is reported on stderr rather than applied silently. A server that fails to connect is named in a diagnostic, mirroring pi's own "registered, but nothing connects it" error.

**10. The envelope is Open WebUI's contract, not an invention.** The adapter that drives an agent from an Open WebUI chat parses these records itself, so anything else would need a second protocol. What it enforces:

| Field | What the adapter does |
| --- | --- |
| `method` | handles only `confirm`, `select`, `input`, `editor`; any other method returns early and is never answered |
| `id` | echoes it back in `extension_ui_response`; required |
| `title` / `message` | `confirm` reads both; `select` and `input` read `title`; `editor` reads `title` and `prefill` |
| `options` | iterated as strings — an object renders as a dict in the dialog |
| `placeholder` | sent by `input` but dropped by the adapter, so the answer must not depend on it |
| `timeout` | milliseconds; the adapter divides by 1000, and pi's option is milliseconds too, so it passes through unchanged |
| response | `{confirmed}`, `{value}`, or `{cancelled}` |
| `notify` / `setStatus` / `setWidget` | not handled, so they stay inert rather than awaiting an answer that never arrives |

## Risks / Trade-offs

- **The arity table drifts on the next pi release.** → Decision 2 contains it: a missing value flag degrades to a warning plus a stray token, never to a mode switch. The parity test compares the table against pi's parsed flags.
- **A dialog holds a tool call open.** → Decision 8: bounded map, per-request timeout, settle on abort/close/shutdown.
- **No reconnect survival.** A WebUI client that reconnects mid-question gets the aborted-run behaviour, not its question back. → Documented in the README (task 4.3). Revisiting it means moving the pending map into durable state.
- **`hasUI` true raises extension expectations.** An extension may now offer interactive flows in RPC mode that print mode cannot serve. → That is pi's behaviour too; the inert path still exists for the non-RPC modes.
- **Shadowing an `mcp.json` server may surprise.** → It is reported, and the diagnostic names both sources.

## Migration Plan

No stored state changes and no wire change for existing commands. A client that previously hit the print-mode failure now gets an RPC server; a client that never sent a dialog sees no new records. Deployment is a rebuild; rollback is a rebuild of the previous commit.

## Open Questions

None blocking. The reconnect question is decided against in Decision 6 and recorded as a documented limitation; reversing it would change the task breakdown and should be a separate change.
