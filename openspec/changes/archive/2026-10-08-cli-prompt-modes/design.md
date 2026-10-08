# CLI Prompt Modes — Design

## Context

See `proposal.md` — Why. The harness is RPC-only: `src/harness/config.ts` parses flags and environment, ignoring any argument that does not start with `-`; `src/index.ts` opens the durable engine and serves RPC on stdin/stdout. The durable engine already exposes `submit`, `messages`, `lastAssistantText`-equivalent data, and the pi event projection (`watchEvents` → `EventProjector`), so the one-shot modes reuse them.

pi's semantics (from `docs/cli.md`): a positional `message` is an initial prompt; `--print` runs the prompts once and writes the final assistant text; `--mode json` writes a session header then JSONL events; piped stdin prepends to the first prompt; `@path` includes a file or image; `--` stops option parsing; RPC mode rejects `@file` prompt arguments.

## Goals / Non-Goals

**Goals**

- `durable-rpc "do something"` runs the prompt and exits, like pi does for a redirected stream.
- `-p/--print` and `--mode json` produce pi-shaped output; `@file` and piped stdin feed the first prompt.
- RPC mode is unchanged when no positional prompt is given.

**Non-Goals**

- The interactive TUI; `--mode text` terminal behaviour (this harness has no TUI, so a positional prompt always runs one shot).
- `--export`, and `@` expansion beyond one file or image.

## Decisions

### D1: Dispatch on the presence of a positional prompt

`--mode rpc` (or no prompt) keeps the RPC server. A positional prompt selects a one-shot mode: `--mode json` → json, otherwise print. A positional prompt with `--mode rpc` is an error, matching pi's refusal to take prompts in RPC mode.

### D2: Parse prompts like pi's argument grammar

A token that is not an option, and any token after `--`, is a prompt. Options that take a value are consumed by the existing value table; prompt tokens are collected in order.

### D3: Feed the first prompt from stdin and `@path`

When stdin is not a terminal, its contents prepend to the first prompt (pi reads piped stdin). An `@path` token loads the file into the first prompt: a text file becomes text, an image becomes an image content block (the prompt input model already admits images).

### D4: Reuse the durable engine for the run

Open the engine as today, `submit` each prompt, and wait for the submission to settle; then print or stream. Print mode writes the last assistant text from the transcript; json mode writes a session header and then the same event records RPC mode emits, using `EventProjector` and the engine's `isQuiescent`.

### D5: Exit status reflects the answer

Exit `0` when the final prompt is answered, non-zero when it settles `unanswered`, so pipelines can branch on it.

## Risks / Trade-offs

- [A positional prompt on a terminal opens a one-shot instead of a TUI] → documented non-goal; a terminal client uses RPC mode.
- [`--mode json` header must match pi] → copy the documented session header shape (`type`, `version`, `id`, `timestamp`, `cwd`) and pin it with a test.
- [Piped stdin consumed by the wrong mode] → RPC mode keeps reading commands from stdin; piped stdin only feeds a positional prompt.

## Migration Plan

Additive: RPC invocations without a positional prompt are unchanged. Rollback is reverting the change.

## Open Questions

- None that change the specs, approach, or task breakdown.
