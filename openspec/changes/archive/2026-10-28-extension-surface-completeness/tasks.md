## 9. Event dispatch (spec: `pi-extension-host`, `failure-diagnostics`)

- [x] 9.1 Build the serialized dispatch bus and verify handlers run in dispatch order
- [x] 9.2 Dispatch projected session records to handlers and verify agent, turn, message, and tool events arrive
- [x] 9.3 Dispatch model, thinking, session-info, tree, and bash events from their commands and verify each arrives
- [x] 9.4 Replace the message with the input handler text result and verify the model receives it
- [x] 9.5 Contain a throwing handler to a diagnostic and verify the next handler still runs

## 10. Action and resource surface (spec: `pi-extension-host`)

- [x] 10.1 Install the durable-backed action surface and verify sendMessage, appendEntry, and setModel reach the session
- [x] 10.2 Serve a synchronous session snapshot and verify a handler reads entries without awaiting
- [x] 10.3 Apply extension flags from the process arguments and verify a flag argument reaches its registration
- [x] 10.4 Apply discovered resource paths and verify an extension's bundled skill appears in get_commands

## 11. Classification (spec: `pi-extension-host`, `failure-diagnostics`)

- [x] 11.1 Classify surfaces as hosted, inert, or unhosted and verify a real extension set reports no unhosted surface
- [x] 11.2 Accept an inert surface without a diagnostic and verify a renderer registration is silent
- [x] 11.3 Report an unapplied handler result with its field and verify a systemPrompt result is reported
- [x] 11.4 Report an unhosted surface on stderr and verify only the provider-level surfaces are reported

## 12. Verification (specs: all)

- [x] 12.1 Run npm run check and verify it passes
- [x] 12.2 Run the harness with the installed extensions and verify no unhosted-surface diagnostic remains
