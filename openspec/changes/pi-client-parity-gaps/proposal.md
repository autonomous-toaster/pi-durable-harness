## Why

Two external clients already drive this harness, and both hit gaps that the harness's own startup contract rules out.

Open Terminal launches an agent with `--mode rpc --session-id <uuid> [--append-system-prompt <text|path>]`. The harness did not know `--append-system-prompt`, so the flag was treated as a boolean and the value became a positional prompt, and `main()` refused the pair and exited `1` before serving RPC. The client received no JSONL and no `agent_settled`. The same outcome follows from any of the other five value-taking flags pi parses and the harness does not.

Open WebUI answers approvals and questions through pi's extension UI sub-protocol. The harness hosts extensions with an inert `ctx.ui` and no `hasUI`, so an extension's ask tool takes its "no interactive client" branch and every approval dialog is silent. An extension's tool also received no `sessionManager`, so the client's chat tool could not identify the conversation, and its command handler received an empty context, so a command that calls `ctx.ui.notify` threw. Pi extensions that call `pi.registerMcpServer` were ignored too: pi records the server, the harness never read the registry.

These are client-facing compatibility gaps, not implementation details, so the RPC parity claim is currently false for the two launch paths that exist.

## What Changes

- **BREAKING** for the claim "the harness accepts pi's full argument list": it now parses pi's value-taking flags with pi's arity, including `--system-prompt` and the repeatable `--append-system-prompt`, and resolves a value that names an existing file to that file's contents.
- An explicit `--mode rpc` no longer yields to a positional argument. A stray token is reported on stderr and ignored, instead of switching the process to print mode.
- The system prompt flags reach the prompt: `--system-prompt` replaces the preamble, `--append-system-prompt` adds an `addendum` section, layered over the resource loader's own values.
- Extensions gain pi's dialog sub-protocol: an `extension_ui_request` record is sent to the RPC client, its `extension_ui_response` is correlated by id, and the extension's `ctx.ui.select/confirm/input/editor` resolves with the client's answer. `ctx.hasUI` reports true.
- **BREAKING** for the claim "extension UI is out of scope": it is now a hosted surface, limited to a dialog raised inside a running tool. Parking a tool call before it runs stays out of scope because pi-durable 1.5.2 cannot park.
- MCP servers registered by an extension through `pi.registerMcpServer` are connected like servers from `mcp.json`, and one that cannot be connected is reported rather than dropped.
- **BREAKING** for the claim "an extension sees pi's context": tools, commands, and session handlers all receive one context carrying `cwd`, `mode`, `hasUI`, `ui`, and `sessionManager`, with `hasUI` taken from the attached client rather than hardcoded.

A pending dialog does not survive a client reconnect or a process restart: the run aborts and the dialog settles unanswered. Surviving a reconnect needs the pending map in durable state, which this change does not take on.

## Capabilities

### New Capabilities

- `extension-ui`: the request/response envelope on the RPC stream, `ctx.hasUI`, the dialog methods an extension may raise inside a tool, and how a pending dialog settles on abort or shutdown.

### Modified Capabilities

- `rpc-parity`: startup parses pi's value-taking flags with pi's arity, including the system prompt flags, and resolves a file-valued argument.
- `cli-prompt-modes`: an explicit RPC mode ignores positional arguments, and the system prompt flags reach the section builder.
- `pi-extension-host`: extension-registered MCP servers are connected and reported, and one context serves tools, commands, and session handlers.

## Impact

- **Code**: `src/harness/config.ts` (flag table, arity, file resolution, positional guard), `src/index.ts` (pass the flags into the prompt extension), `src/harness/prompt.ts` (custom prompt and addendum from argv), `src/rpc/server.ts` and `src/rpc/session.ts` (request/response correlation, pending map, abort), `src/extensions/host.ts` (`hasUI`, `ui` bound to the session, MCP registry merge), `src/tools/mcp.ts` (merge extension servers, diagnose failures).
- **Dependencies**: none new. pi's CLI parser is not imported; the arity table is mirrored so the harness keeps a supported surface.
- **Verification**: a startup test that launches the harness with Open Terminal's literal argv and asserts `get_state` answers; a dialog test that answers a fixture extension's `ctx.ui.confirm` and one that aborts mid-dialog; an MCP test whose fixture extension registers a server.
- **Risk**: the arity table can drift from pi's on the next release. The guard that an explicit `--mode rpc` never yields to a positional argument is what keeps drift from becoming a silent mode switch.
- **Risk**: a dialog holds a tool call open, so a misbehaving client stalls a run. The pending map is bounded and every entry settles on abort, on stdin close, and on shutdown.
- **Not addressed**: pre-execution approval gates need durable's signal/park API, which is unreleased in 1.5.2.
