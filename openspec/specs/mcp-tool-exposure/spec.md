# mcp-tool-exposure Specification

## Purpose
Defines how the harness classifies MCP tools by exposure, computes the tool set declared to the model, reaches undeclared tools from scripts and search, and exposes MCP resources, so the harness behaves like pi for the same `mcp.json`.

## Requirements

### Requirement: Config parse precedes resolution

T1.1 SHALL complete BEFORE T1.2 SHALL run.

#### Scenario: Resolution follows the config parse

- **WHEN** T1.1 completes
- **THEN** T1.2 SHALL run

### Requirement: Resolution precedes the exposure table

T1.2 SHALL complete BEFORE T1.3 SHALL run.

#### Scenario: Exposure table follows resolution

- **WHEN** T1.2 completes
- **THEN** T1.3 SHALL run

### Requirement: Exposure table precedes the declared set

T1.3 SHALL complete BEFORE T2.1 SHALL run.

#### Scenario: Declared set follows the exposure table

- **WHEN** T1.3 completes
- **THEN** T2.1 SHALL run

### Requirement: Activation precedes the declared set

T2.2 SHALL complete BEFORE T2.1 SHALL run.

#### Scenario: Declared set follows activation

- **WHEN** T2.2 completes
- **THEN** T2.1 SHALL run

### Requirement: Exposure table precedes the codemode table

T1.3 SHALL complete BEFORE T3.1 SHALL run.

#### Scenario: Codemode table follows the exposure table

- **WHEN** T1.3 completes
- **THEN** T3.1 SHALL run

### Requirement: Codemode table precedes the declaration text

T3.1 SHALL complete BEFORE T3.2 SHALL run.

#### Scenario: Declaration text follows the codemode table

- **WHEN** T3.1 completes
- **THEN** T3.2 SHALL run

### Requirement: Resolution precedes tool search

T1.2 SHALL complete BEFORE T4.1 SHALL run.

#### Scenario: Tool search follows resolution

- **WHEN** T1.2 completes
- **THEN** T4.1 SHALL run

### Requirement: Resolution precedes resources

T1.2 SHALL complete BEFORE T5.1 SHALL run.

#### Scenario: Resources follow resolution

- **WHEN** T1.2 completes
- **THEN** T5.1 SHALL run

### Requirement: Resources precede the prompt section

T5.1 SHALL complete BEFORE T5.2 SHALL run.

#### Scenario: Prompt section follows resources

- **WHEN** T5.1 completes
- **THEN** T5.2 SHALL run

### Requirement: Prompt builder precedes prompt sections

T5.3 SHALL complete BEFORE T5.4 SHALL run.

#### Scenario: Prompt sections follow the builder

- **WHEN** T5.3 completes
- **THEN** T5.4 SHALL run

### Requirement: The prompt builder matches pi

T5.3 SHALL ALWAYS reproduce pi's system-prompt section builder.

#### Scenario: The prompt builder matches pi

- **WHEN** T5.3 runs
- **THEN** T5.3 SHALL reproduce pi's system-prompt section builder

### Requirement: Prompt sections use the declared tool set

T5.4 SHALL ALWAYS build the prompt sections from the declared tool set.

#### Scenario: Prompt sections use the declared tool set

- **WHEN** T5.4 runs
- **THEN** T5.4 SHALL build the prompt sections from the declared tool set

### Requirement: Built-in tool definitions match pi

T5.5 SHALL ALWAYS use pi's description and parameters for the built-in tools.

#### Scenario: Built-in tool definitions match pi

- **WHEN** T5.5 runs
- **THEN** T5.5 SHALL use pi's description and parameters for the built-in tools

### Requirement: Codemode and tool search definitions match pi

T5.6 SHALL ALWAYS use pi's description and parameters for codemode and tool_search.

#### Scenario: Codemode and tool search definitions match pi

- **WHEN** T5.6 runs
- **THEN** T5.6 SHALL use pi's description and parameters for codemode and tool_search

### Requirement: MCP tool descriptions match pi

T5.7 SHALL ALWAYS render an MCP tool description as pi does.

#### Scenario: MCP tool descriptions match pi

- **WHEN** T5.7 runs
- **THEN** T5.7 SHALL render an MCP tool description as pi does

### Requirement: Project resources respect the trust grant

T5.8 SHALL ALWAYS gate project resources on a trust grant.

#### Scenario: Project resources respect the trust grant

- **WHEN** T5.8 runs
- **THEN** T5.8 SHALL gate project resources on a trust grant

### Requirement: The mcp_servers text matches pi

T5.9 SHALL ALWAYS render the mcp_servers section as pi does.

#### Scenario: The mcp_servers text matches pi

- **WHEN** T5.9 runs
- **THEN** T5.9 SHALL render the mcp_servers section as pi does

### Requirement: Trust precedes the prompt sections

T5.8 SHALL complete BEFORE T5.4 SHALL run.

#### Scenario: Prompt sections follow the trust decision

- **WHEN** T5.8 completes
- **THEN** T5.4 SHALL run

### Requirement: Tool definitions precede the diff

T5.5 SHALL complete BEFORE T6.2 SHALL run.

#### Scenario: The diff follows the built-in tool definitions

- **WHEN** T5.5 completes
- **THEN** T6.2 SHALL run

### Requirement: Indirect tool definitions precede the diff

T5.6 SHALL complete BEFORE T6.2 SHALL run.

#### Scenario: The diff follows the codemode and tool search definitions

- **WHEN** T5.6 completes
- **THEN** T6.2 SHALL run

### Requirement: MCP descriptions precede the diff

T5.7 SHALL complete BEFORE T6.2 SHALL run.

#### Scenario: The diff follows the MCP descriptions

- **WHEN** T5.7 completes
- **THEN** T6.2 SHALL run

### Requirement: The server section precedes the diff

T5.9 SHALL complete BEFORE T6.2 SHALL run.

#### Scenario: The diff follows the mcp_servers text

- **WHEN** T5.9 completes
- **THEN** T6.2 SHALL run

### Requirement: Capture precedes the diff

T6.1 SHALL complete BEFORE T6.2 SHALL run.

#### Scenario: Diff follows capture

- **WHEN** T6.1 completes
- **THEN** T6.2 SHALL run

### Requirement: Project overrides merge over global servers

T1.1 SHALL ALWAYS merge project enabled, exposure, and toolExposure over the global server.

#### Scenario: Project override merges

- **WHEN** T1.1 runs
- **THEN** T1.1 SHALL merge project enabled, exposure, and toolExposure over the global server

### Requirement: Server exposure defaults to codemode

T1.2 SHALL ALWAYS default a server exposure to codemode.

#### Scenario: Exposure defaults to codemode

- **WHEN** T1.2 runs
- **THEN** T1.2 SHALL default a server exposure to codemode

### Requirement: Exact tool exposure wins over a pattern

T1.2 SHALL ALWAYS prefer an exact toolExposure name over a pattern.

#### Scenario: Exact name wins

- **WHEN** T1.2 runs
- **THEN** T1.2 SHALL prefer an exact toolExposure name over a pattern

### Requirement: The server is the tool namespace

T1.3 SHALL ALWAYS record the server as each MCP tool namespace.

#### Scenario: Namespace is the server

- **WHEN** T1.3 runs
- **THEN** T1.3 SHALL record the server as each MCP tool namespace

### Requirement: Declared set includes built-ins and direct tools

T2.1 SHALL ALWAYS include the built-in tools and every direct MCP tool in the declared set.

#### Scenario: Declared set includes built-ins and direct tools

- **WHEN** T2.1 runs
- **THEN** T2.1 SHALL include the built-in tools and every direct MCP tool in the declared set

### Requirement: Declared set excludes codemode and deferred tools

T2.1 SHALL ALWAYS leave codemode and deferred MCP tools out of the declared set.

#### Scenario: Declared set excludes codemode and deferred tools

- **WHEN** T2.1 runs
- **THEN** T2.1 SHALL leave codemode and deferred MCP tools out of the declared set

### Requirement: Codemode table includes codemode and deferred tools

T3.1 SHALL ALWAYS include every codemode and deferred MCP tool in the codemode table.

#### Scenario: Codemode table includes codemode and deferred tools

- **WHEN** T3.1 runs
- **THEN** T3.1 SHALL include every codemode and deferred MCP tool in the codemode table

### Requirement: Deferred codemode servers render as name and count

T3.2 SHALL ALWAYS render a codemode-deferred server as the server name and tool count.

#### Scenario: Deferred codemode server renders as name and count

- **WHEN** T3.2 runs
- **THEN** T3.2 SHALL render a codemode-deferred server as the server name and tool count

### Requirement: Declaration text stays within the token budget

T3.2 SHALL ALWAYS keep the codemode declaration within the token budget.

#### Scenario: Declaration text stays within the token budget

- **WHEN** T3.2 runs
- **THEN** T3.2 SHALL keep the codemode declaration within the token budget

### Requirement: Deferred matches are added to the declared set

T4.1 SHALL ALWAYS return addTools for each deferred match.

#### Scenario: Deferred match is added

- **WHEN** T4.1 runs
- **THEN** T4.1 SHALL return addTools for each deferred match

### Requirement: Resource tools are exposed for resource servers

T5.1 SHALL ALWAYS expose a resource tool when a server declares resources.

#### Scenario: Resource tool is exposed

- **WHEN** T5.1 runs
- **THEN** T5.1 SHALL expose a resource tool when a server declares resources

### Requirement: The prompt section lists codemode and deferred servers

T5.2 SHALL ALWAYS list codemode and deferred servers in the mcp_servers section.

#### Scenario: Prompt section lists codemode and deferred servers

- **WHEN** T5.2 runs
- **THEN** T5.2 SHALL list codemode and deferred servers in the mcp_servers section

### Requirement: Both model requests are captured

T6.1 SHALL ALWAYS capture the model request of the harness and pi.

#### Scenario: Both model requests are captured

- **WHEN** T6.1 runs
- **THEN** T6.1 SHALL capture the model request of the harness and pi

### Requirement: The diff reports no difference

T6.2 SHALL ALWAYS report no difference in declared tools, descriptions, or system prompt.

#### Scenario: The diff reports no difference

- **WHEN** T6.2 runs
- **THEN** T6.2 SHALL report no difference in declared tools, descriptions, or system prompt

### Requirement: A codemode server activates codemode

IF T1.2 identifies a codemode server THEN T2.2 SHALL activate codemode.

#### Scenario: Codemode server activates codemode

- **WHEN** T1.2 identifies a codemode server
- **THEN** T2.2 SHALL activate codemode

### Requirement: A deferred server activates tool search

IF T1.2 identifies a deferred server THEN T2.2 SHALL activate tool_search.

#### Scenario: Deferred server activates tool search

- **WHEN** T1.2 identifies a deferred server
- **THEN** T2.2 SHALL activate tool_search

### Requirement: Auto-enable off keeps codemode inactive

IF T1.2 resolves autoEnableCodemode false THEN T2.2 SHALL keep codemode inactive.

#### Scenario: Auto-enable off keeps codemode inactive

- **WHEN** T1.2 resolves autoEnableCodemode false
- **THEN** T2.2 SHALL keep codemode inactive
