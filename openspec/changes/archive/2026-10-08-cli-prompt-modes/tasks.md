## 1. Parsing (spec: `cli-prompt-modes`)

- [x] 1.1 Parse positional prompts and the `--` delimiter
- [x] 1.2 Prepend piped stdin to the first prompt
- [x] 1.3 Resolve `@path` references in the first prompt

## 2. Modes (spec: `cli-prompt-modes`)

- [x] 2.1 Dispatch RPC, print, or json mode
- [x] 2.2 Run the prompts in order to settle
- [x] 2.3 Write the final assistant text in print mode
- [x] 2.4 Write the session header and events in json mode
- [x] 2.5 Reject a positional prompt in RPC mode

## 3. Tests (spec: `cli-prompt-modes`)

- [x] 3.1 Test the invocation modes
