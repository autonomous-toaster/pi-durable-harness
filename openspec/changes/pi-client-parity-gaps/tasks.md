## 1. Argument parity (spec: `rpc-parity`, `cli-prompt-modes`)

- [x] 1.1 Add `--system-prompt` and the repeatable `--append-system-prompt` to the value-flag table. Record both in the configuration. Verify a parse test sees the replacement and two appended texts
- [x] 1.2 Mirror pi 1.5.2's remaining value-taking flags (`--api-key`, `--export`, `--fork`, `--models`, `--prompt-template`, `--skill`, `--theme`). Verify the table covers each flag pi parses with a value
- [x] 1.3 Resolve a flag value that names an existing file to the file's contents. Verify a file value and a literal value both parse
- [x] 1.4 Keep the interface at RPC when the mode is explicit and a positional argument follows. Verify a stray token warns and the RPC server starts
- [x] 1.5 Pass the system prompt flags into the prompt extension. Verify the rendered prompt carries the replacement preamble and each addendum

## 2. Extension MCP servers (spec: `pi-extension-host`)

- [x] 2.1 Merge the servers an extension registers into MCP resolution, with a shadowing diagnostic. Verify a fixture extension's server connects
- [x] 2.2 Report each extension server that cannot connect. Verify the diagnostic names the server

## 3. Extension UI (spec: `extension-ui`)

- [x] 3.1 Send an `extension_ui_request` for each dialog call and correlate `extension_ui_response` by id. Verify a response resolves its pending dialog
- [x] 3.2 Expose `hasUI` and route select, confirm, input, and editor to the client. Verify a fixture tool receives the client's answer
- [x] 3.3 Settle every pending dialog as cancelled on abort, stdin close, and shutdown, honouring each request's timeout. Verify a dialog settles unanswered
- [x] 3.4 Ignore a response whose id names no pending request. Verify the process keeps serving

## 4. Verification

- [x] 4.1 Add a startup test that launches the harness with Open Terminal's literal argv. Verify `get_state` answers
- [x] 4.2 Add a dialog test covering one answered dialog and one aborted dialog
- [x] 4.3 Verify the README records the hosted dialog methods and the no-reconnect limitation

## 5. Extension context (spec: `pi-extension-host`, `extension-ui`)

- [x] 5.1 Pass the session view into every tool context, refreshed per call. Verify a fixture tool reads the session id `get_state` reports
- [x] 5.2 Build the command and session-handler contexts from the same factory. Verify `ctx.ui.notify` does not throw
- [x] 5.3 Report `hasUI` from the attached client. Verify it is false without a client and true with one
