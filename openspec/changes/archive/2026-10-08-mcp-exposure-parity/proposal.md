# MCP Exposure Parity

## Why

The harness reimplements MCP support with a simplified model: every discovered tool is declared to the model directly. `pi-coding-agent` instead classifies each MCP tool by **exposure** (`direct`, `model-only`, `codemode`, `codemode-deferred`, `deferred`, `hidden`) and activates `codemode`/`tool_search` on demand, so large servers stay out of the model's declarations. For the same `mcp.json` the harness therefore behaves differently from pi, and is not a drop-in for clients that rely on pi's tool-exposure behavior.

## What Changes

- Parse `mcp.json` exactly as pi does: global (`$PI_CODING_AGENT_DIR/mcp.json`) merged with project (`<cwd>/.pi/mcp.json`), where a project entry overrides only `{enabled, exposure, toolExposure}` of the global server of the same name.
- Honor `enabled`, `exposure` (default `codemode`), per-tool `toolExposure` overrides (exact name beats pattern; first matching pattern wins), and `autoEnableCodemode` (default `true`).
- Classify every MCP tool with a per-tool **exposure**, **namespace** (its server), and **annotations**; name tools `mcp__<server>__<tool>` with pi's description fallback.
- Compute the **declared (active) set** as an explicit durable tool list: built-ins + `direct`/`model-only` MCP tools + activated `codemode`/`tool_search` + previously loaded deferred tools. Every other MCP tool stays installed but undeclared.
- Build the `codemode` tool table from the registry (so undeclared tools are callable from scripts), using pi's own declaration rendering (`renderDeclarations`, `renderToolSignature`, `schemaToType`), namespace grouping, a `<server> (N tools)` summary for `codemode-deferred`, and the declaration token budget.
- Make `tool_search` declare deferred tools by returning `control.addTools`; durable records the tool change as a positional system entry, so the declaration persists on the branch.
- Activate `codemode` when a `codemode` or `codemode-deferred` server connects (unless `autoEnableCodemode` is false) and `tool_search` when a `deferred` server connects; warn once when a needed tool is not active.
- Expose MCP **resources** (`read_mcp_resource` and resource links) as pi does.
- Add the `mcp_servers` system-prompt section listing `codemode`/`deferred` servers.
- Reproduce pi's **system prompt sections** exactly (preamble, tools, rules, docs, addendum, project context, skills, cwd, `mcp_servers`) by porting pi's section builder and feeding it the declared tool set.
- Match pi's **tool definitions** in the model request: the built-in `read`/`bash`/`edit`/`write` descriptions and parameter schemas, the `codemode`/`tool_search` definitions, the MCP tool descriptions, and the `mcp_servers` section text.
- Enforce **project trust** before loading project resources, as pi does, so project skills and instructions are absent from the prompt for an untrusted project.

Explicit non-goal: **nested-call semantics**. `tool_execution_*` events with `parentToolCallId`, `nestedCalls`/usage recorded on the tool-result message, and pipeline hooks for calls a tool makes itself are out of scope.

## Capabilities

### New Capabilities

- `mcp-tool-exposure`: `mcp.json` parsing and merge, per-tool exposure/namespace/annotations, the declared-set computation, `codemode`/`tool_search` activation, and MCP resources.

### Modified Capabilities

- `harness-tooling-parity`: the MCP support, tool-search, and codemode requirements change from simplified direct declaration to pi's exposure semantics.

## Impact

- **Code**: rewrite `src/tools/mcp.ts`; add an exposure module; change `src/tools/codemode.ts` to read the registry and render declarations with pi's helpers; change `src/tools/tool-search.ts` to return `control.addTools`; change `src/harness/engine.ts` to configure an explicit declared tool set and activation; port pi's system-prompt section builder into `src/harness/system-prompt.ts` and rebuild `src/harness/prompt.ts` on it.
- **Dependencies**: reuse `@earendil-works/pi-mcp` (client, transports, oauth) and `@earendil-works/pi-codemode` (sandbox, declaration rendering); port the MCP glue (`mcp/config.ts`, `mcp/tools.ts`, `mcp/index.ts`, tool-search/codemode glue) from pi-coding-agent source (MIT). No changes to `pi-durable`.
- **Behavior**: every session now configures an explicit declared tool set, because durable's `addTools` is a no-op without one; tools that are not computed into the list are no longer implicitly declared.
- **Verification**: a differential harness compares the model requests (tool names, order, descriptions, system prompt) and the RPC transcripts of the harness and a pinned pi for the same `mcp.json`, using in-memory MCP servers and a mock model endpoint.
- **Risk**: port drift as pi evolves, and exactness of the declaration token budget.
