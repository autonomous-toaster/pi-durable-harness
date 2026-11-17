# Proposal

## Why

pi loads user-authored themes, keeps one prompt cache entry warm between turns, and prints
where a session lives in its info panel. This harness accepts `--theme` and loads nothing,
answers the panel's cache-warming question with "unavailable", and disagrees with itself about
the session's location: the panel prints `postgres:durable/default__envprobe` while RPC answers
`null` for the same session.

## What Changes

- Load themes from the command line: `--theme <path>` (repeatable, a file or a directory),
  `--no-themes`, and `--use-theme <name>`, wired to the resource loader that pi's own TUI reads,
  so a loaded theme appears in the theme picker and the selected one is active at startup.
- Run pi's cache warmer over the request seam durable calls: a session request arms a refresh,
  a settled turn schedules one, and an extension may override the decision. The warmer's status
  reaches pi's info panel, so `/session` prints pi's Cache Warming block instead of "unavailable".
- Record a refresh as a usage entry, so the transcript shows pi's warm line and the session cost
  includes the warm.
- Report one session location: the panel and RPC read the same value. A local session reports its
  path, a PostgreSQL session reports its storage identity.

## Capabilities

### New Capabilities

None. Every requirement lands on a capability that already owns the surface.

### Modified Capabilities

- `cli-prompt-modes`: the three theme flags, their values, and the help text.
- `tui-parity`: a loaded theme reaching the theme picker, the selected theme at startup, the
  Cache Warming block in the info panel, and one location line.
- `rpc-parity`: the session location a persisted session reports.
- `pi-extension-host`: a `cache_warming_decision` result that the harness applies.
- `transcript-projection`: the warm line a cache refresh adds to the transcript.

## Impact

- `src/harness/config.ts`: the flag table gains `no-themes` and `use-theme`, and `theme` becomes
  repeatable.
- `src/index.ts`: both resource-loader constructions receive the theme paths and the switch; the
  settings override carries the selected theme.
- `src/harness/engine.ts`: the warmer is constructed, started at the model seam, settled, and
  cancelled with the session; a refresh records a usage entry.
- `src/harness/tui/adapter.ts`: the status getter answers from the warmer, and the location line
  reads the shared value.
- `src/harness/tui/run.ts`: the selected theme reaches pi's TUI.
- `src/rpc/session.ts`: the location value replaces `null`.
- `src/harness/pi-internals.ts`: a loader for the warmer module, following the existing pattern.
- `scripts/build-*.mjs`: the warmer module joins the bundled set.
- `README.md` and the `--help` text: the theme flags and the cache warming limitation, which this
  change removes.
