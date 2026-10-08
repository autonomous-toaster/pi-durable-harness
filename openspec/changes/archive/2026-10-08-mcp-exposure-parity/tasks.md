## 1. Exposure model and config (spec: `mcp-tool-exposure`)

- [x] 1.1 Parse global and project mcp.json
- [x] 1.2 Resolve enabled, exposure, toolExposure, and autoEnableCodemode
- [x] 1.3 Build the per-tool exposure table

## 2. Declared set (spec: `mcp-tool-exposure`)

- [x] 2.1 Configure the explicit declared tool set
- [x] 2.2 Activate codemode and tool_search by exposure

## 3. Codemode (spec: `mcp-tool-exposure`)

- [x] 3.1 Build the codemode table from the registry
- [x] 3.2 Render the codemode declaration text

## 4. Tool search (spec: `mcp-tool-exposure`)

- [x] 4.1 Return addTools for each deferred match

## 5. Resources and prompt (spec: `mcp-tool-exposure`)

- [x] 5.1 Expose the MCP resource tools
- [x] 5.2 Add the mcp_servers prompt section
- [x] 5.3 Port pi's system-prompt section builder
- [x] 5.4 Build the prompt sections from the declared tool set
- [x] 5.5 Port pi's built-in tool definitions
- [x] 5.6 Match the codemode and tool_search definitions
- [x] 5.7 Match the MCP tool descriptions
- [x] 5.8 Enforce project trust for project resources
- [x] 5.9 Match the mcp_servers section text

## 6. Differential harness (specs: `mcp-tool-exposure`, `harness-tooling-parity`)

- [x] 6.1 Capture the model request of the harness and pi
- [x] 6.2 Diff declared tools, descriptions, system prompt, and transcripts
