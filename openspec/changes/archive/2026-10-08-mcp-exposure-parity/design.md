# MCP Exposure Parity — Design

## Context

See `proposal.md` — Why. Current state and the constraints that shape the approach:

- The harness loads MCP servers in `src/tools/mcp.ts` and installs **every** discovered tool into the durable registry, so all of them are declared. There is no exposure concept.
- `pi-coding-agent` keeps exposure, the active/declared set, `prepareLoadout`, and nested-call handling inside its `AgentSession`; the built-in `mcp`, `codemode`, and `tool_search` extensions are not exported. Only `@earendil-works/pi-mcp` and `@earendil-works/pi-codemode` are published as libraries.
- Durable provides the primitives this change needs, verified in source:
  - `agent.tools` as an **explicit array** is the declared set; `undefined` means "every installed tool".
  - `ToolControl.addTools` appends names to that array and is effective from the next request — but it is a **no-op when `agent.tools` is undefined**.
  - Tool changes are recorded as positional `pi.system` entries and replayed (`planSystemEntries` / `planTools`), so a declared tool persists on the branch.
  - `ToolExecutionApi.registry` exposes every installed tool, offered or not.

## Goals / Non-Goals

**Goals**

- For the same `mcp.json`, produce the same observable behavior as a pinned `pi-coding-agent`: the same declared tool set (names, order), the same tool descriptions (notably the `codemode` text), the same `mcp_servers` system-prompt section, and the same `tool_search` activation.
- Keep the engine durable-native (no changes to `pi-durable`, no hosting pi's `AgentSession`).

**Non-Goals**

- Nested-call semantics: `parentToolCallId` events, `nestedCalls`/usage on the tool-result message, and pipeline hooks for calls a tool makes itself.
- pi's general extension runtime (`prepareLoadout` beyond MCP, `ctx.executeTool` for arbitrary tools, permission extensions, annotations consumed by third-party extensions).
- `/mcp` interactive management and `pi mcp` CLI.

## Decisions

### D1: Port onto durable (strategy A), not host pi, not upstream

Port pi's exposure + MCP glue onto durable and prove equivalence with a differential harness. Alternatives: host pi's `AgentSession` (exact by construction but abandons the durable loop), upstream the runtime into `pi-durable` (cleanest long-term, but a dependency change). Chosen because the requirement is *observable* exactness and durable already carries the loadout primitives.

### D2: An exposure side table keyed by tool name

`exposure -> { server, exposure, namespace, annotations }` lives beside the registry, not inside tool registrations. This keeps the harness self-contained while making a later move to a durable-level `exposure` field mechanical (the side table becomes the registration field).

### D3: Configure an explicit declared tool set

The engine computes `agent.tools` explicitly — built-ins, `direct`/`model-only` MCP tools, the activated `codemode`/`tool_search`, and tools previously added by `tool_search`. This is **required**, because `addTools` does nothing without an explicit array. Consequence: a tool that is not computed into the list is no longer implicitly declared, so the computation must account for every installed tool (a default "declare unless exposure says otherwise" rule for non-MCP tools).

### D4: `codemode` reads the registry and renders with pi's helpers

The sandbox table is built from `ToolExecutionApi.registry` filtered by exposure (`codemode`, `codemode-deferred`, `deferred`, `direct`), not from `agent.tools`, so undeclared tools are callable from scripts. The declaration text uses `@earendil-works/pi-codemode`'s `renderDeclarations`/`renderToolSignature`/`schemaToType`, grouping by namespace and summarizing `codemode-deferred` servers as `<server> (N tools)`. The description is fixed at session start (MCP servers connect before the Harness opens), which is observationally identical while servers do not change mid-session.

### D5: `tool_search` declares tools through `control.addTools`

The tool returns `{ control: { addTools: names } }`; durable appends them to the explicit list and writes the `pi.system` declaration next request, giving "declared from the next call, recorded in the transcript, persists on the branch" without new state.

### D6: Activation and warnings

`codemode` is activated when a `codemode`/`codemode-deferred` server connects and `tool_search` when a `deferred` server connects. `autoEnableCodemode: false` suppresses the codemode activation. A one-time warning is emitted when a server needs a tool that is not active. `models.json` `defaultTools` (`+codemode`, `+tool_search`) can force them on.

### D7: Config merge exact to pi

Global `$PI_CODING_AGENT_DIR/mcp.json` merged with project `<cwd>/.pi/mcp.json`; a project entry without `command`/`url`/`type` overrides only `{enabled, exposure, toolExposure}` of the same-named global server. `toolExposure` resolves an exact tool name over patterns; among patterns the first match wins.

### D8: Reuse libraries, port only the glue, pin the version

`@earendil-works/pi-mcp` (client, transports, oauth) and `@earendil-works/pi-codemode` (sandbox, rendering) are used as-is. The MCP glue (`mcp/config.ts`, `mcp/tools.ts`, `mcp/index.ts`, and the tool-search/codemode glue) is ported from pi-coding-agent source (MIT) and pinned to a pi version recorded with the differential fixtures.

### D9: A differential harness is the acceptance gate

Because tool declarations are **not** on the RPC wire, the oracle is the model request. The harness runs `pi` and this harness against the same `mcp.json` with in-memory MCP servers (`pi-mcp/testing`) and a mock model endpoint that records the request, then diffs tool names, order, descriptions, the `mcp_servers` section, and the RPC transcript (`get_entries`, `get_state`, events). No exactness claim without it. The diff covers the **whole model request**, including the system prompt, because the spec requires it.

### D10: The system prompt is built by pi's own section builder

To make the model request match pi, the harness ports pi's `buildSystemPromptSections` (a self-contained 151-line module whose inputs are the declared tool set, tool snippets/guidelines, context files, and skills — all inputs the harness already produces) into `src/harness/system-prompt.ts`. The port imports `getDocsPath`/`getExamplesPath`/`getReadmePath`/`formatSkillsForPrompt` from `@earendil-works/pi-coding-agent` (the same helpers pi uses) and `getSystemMessageText` from `@earendil-works/pi-ai`, so the section text is identical. Built-in tool snippets and guidelines (`readToolSystemPromptContribution` and friends) are ported as data. The `mcp_servers` section is passed as a custom section, as the MCP extension does. Alternative: keep the simplified prompt and narrow the spec — rejected by the user.

### D11: Tool definitions and trust are ported too

The differential harness (D9) showed the model request also differs in the built-in tool definitions, the `codemode`/`tool_search` definitions, the MCP tool descriptions, the `mcp_servers` text, and project trust. So the harness wraps durable's `read`/`bash`/`edit`/`write` execution with pi's exact `description` and `parameters`, adopts pi's `codemode`/`tool_search` definitions (description, schema, snippets, and the codemode guideline), reproduces the MCP description rule (`tool.description?.trim() || title || "MCP tool <name> from server <server>"`), copies pi's `mcp_servers` section rendering (intro, `- <server> (<reach>)` lines, description truncation, omission line, `MAX_SERVERS_SECTION_CHARS`), and loads project resources only when `SettingsManager.isProjectTrusted()` is true. Alternative: narrow the diff to MCP observables — rejected by the user.

## Risks / Trade-offs

- [Explicit tool set silently hides tools] → Compute the declared set with a default-declare rule for non-MCP tools, and assert the built-in set is present in a test.
- [Declaration token-budget mismatch] → Reuse pi-codemode's rendering and pin the pi version; the differential harness fails on any diff.
- [Port drift as pi evolves] → Pin the pi version, record it with the fixtures, and keep the ported glue isolated in one module so an update is mechanical.
- [MCP resources widen scope] → Port them with the same glue and cover them in the differential harness.
- [Durable's `addTools` is experimental] → Guard with a test that asserts the declaration appears in `get_entries` after `tool_search`.

## Migration Plan

Additive behind the existing MCP loading path: no stored-data migration. Rollback is reverting the change; the declared-set computation is the only behavior that affects every session, so it lands first with its test before the exposure filtering is enabled.

## Open Questions

- None that change the specs, approach, or task breakdown. The exact pi version pinned for the differential fixtures is chosen when the harness is written.
