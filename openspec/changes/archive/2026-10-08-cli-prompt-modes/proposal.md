# CLI Prompt Modes

## Why

The harness serves pi's RPC protocol only. pi also runs a positional prompt in one shot (`pi "do something"`, `pi -p "..."`, `pi --mode json "..."`), which scripts and pipelines rely on. Today `durable-rpc "do something"` ignores the prompt and waits on stdin, so it is not a drop-in for those invocations.

## What Changes

- Accept **positional prompts** (arguments that are not options; `--` ends option parsing).
- When a prompt is present, run it in one shot and exit:
  - `-p`, `--print` writes the final assistant text to stdout;
  - `--mode json` writes a session header and then JSONL events to stdout;
  - `--mode text` (the default) falls back to print mode.
- **Prepend piped stdin** to the first prompt when stdin is not a terminal.
- Resolve **`@path`** references (text files and images) into the first prompt.
- **Reject positional prompts in `--mode rpc`**, where prompts arrive through the `prompt` command.
- Exit `0` when a prompt is answered and non-zero when it is unanswered.

Non-goals: the interactive TUI, `--mode text` terminal behaviour, `--export`, and `@` expansion beyond a single file or image.

## Capabilities

### New Capabilities

- `cli-prompt-modes`: positional prompts and the one-shot print and json invocation modes.

### Modified Capabilities

- None.

## Impact

- **Code**: `src/harness/config.ts` (parse prompts, `--print`, `--mode json`, piped stdin), a new `src/harness/oneshot.ts` (run the prompts and write the output), and `src/index.ts` (dispatch between RPC and the one-shot modes). The durable engine's `submit`, `messages`, and event stream are reused unchanged.
- **Behavior**: `durable-rpc "..."` runs the prompt and exits instead of waiting on stdin; RPC mode is unchanged for invocations without a positional prompt.
- **Docs**: the README startup-contract table gains the positional prompt and the new flags.
