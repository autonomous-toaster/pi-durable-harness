# Design

## Context

The harness runs pi's own `InteractiveMode` over a fake session surface
(`src/harness/tui/adapter.ts`), so every panel is pi's rendering of values the adapter answers.
Three of those values are stubs or inventions today.

Themes: pi's interface reads themes from `session.resourceLoader.getThemes()` and applies a
startup selection from `initialThemeSetting`. The adapter already forwards the loader
(`options.resourceLoader`), and both loader constructions in `src/index.ts` omit
`additionalThemePaths` and `noThemes`, which pi's loader accepts. `theme` sits in the flag table
as a single ignored string.

Cache warming: `src/harness/tui/adapter.ts` answers `cacheWarmingStatus` with `undefined`, so
pi's info panel prints "Inactive (cache warming unavailable)". pi's own machinery is available:
`CacheWarmer` (`@earendil-works/pi-coding-agent/dist/core/cache-warmer.js`) takes a model runtime,
an entry sink, a mode getter, and a decision hook. Durable takes the model runtime we hand to
`Harness.open({ models })` and calls it for every request, so the runtime is the seam.

Session location: `src/index.ts` builds `postgres:<schema>/<tenant>__<key>` for a PostgreSQL
session and a real path for SQLite, and passes that value to the TUI, while
`src/rpc/session.ts` answers `null` for both.

## Goals / Non-Goals

**Goals:**

- A theme a user names on the command line loads, lists, and applies.
- Warming runs through pi's own `CacheWarmer`, so the panel, the schedule, and the extension
  hook behave as pi's do.
- One function produces the session location, and both surfaces read it.

**Non-Goals:**

- No second warmer, schedule, or economics model of our own.
- No theme authoring help text or theme file validation of our own: pi's loader validates.
- No change to how a session is stored, and no new column or file for the location.

## Decisions

**Reuse pi's `CacheWarmer` rather than a bespoke scheduler.** The class owns the expiry window,
the economics, the extension hand-off, and the status object the panel reads. Reimplementing any
of it would drift on the next pin. The module is not in the package's `exports` map, so it enters
through the existing `pi-internals.ts` pattern: a specifier the bundler resolves and a file URL
as the fallback for the plain `dist/` build.

**Wrap the runtime durable is given, rather than hooking durable.** `Harness.open` takes
`models`, and durable calls `streamSimple` for each request. A wrapper answers `streamSimple` by
starting the warmer with the request and delegating. This keeps the request path inside durable:
we observe the exact model, context, and options the provider receives, with no durable change.

**Copy pi's currency rule for a warm.** pi restarts warming only when a session request replaces
the entry, and keeps warming while the transcript still extends the request's prefix. A refresh is
current when the session id matches and the projected messages still start with the request's
context, compared structurally, because durable reconstructs message arrays.

**A refresh records a usage entry, and the transcript shows it.** pi's `onWarmed` appends a usage
entry and emits `entry_appended`. The harness has no usage table, so a refresh becomes a control
entry (`cache_warm`) carrying its cost and tokens, projected into pi's warm line. This is the same
mechanism `bash_result` already uses, and it keeps `/session` cost and the transcript in agreement.
Alternative: keep warm cost out of the store — rejected, because `/session` cost would then omit
what pi includes, and a restart would lose the line pi keeps.

**The decision hook becomes applied, not reported.** pi lets a `cache_warming_decision` handler
override the action. The harness currently reports the hook on stderr, which cannot affect a run.
The warmer's `decide` callback dispatches the hook and returns its action, falling back to pi's
decision when no handler exists or the handler fails. The stderr report stays for the hooks that
remain unapplied.

**One location value, built once.** A local session reports its file path. A PostgreSQL session
reports the storage identity `postgres:<schema>/<tenant>__<key>` rather than an invented file path
and rather than `null`. pi's panel formats `File: <path>`, so this is the one line where a durable
store shows an address instead of a path; a fabricated path would be a worse claim, and `null`
would print "In-memory" for a session that is stored on a server.

**The selected theme goes through the settings override.** pi's `main` calls
`settingsManager.applyOverrides({ theme })` and hands `initialThemeSetting` to the interface. The
harness does the same, so a flag and a stored selection cannot disagree, and `/theme` persists what
the session started on.

## Risks / Trade-offs

- [A refresh runs a provider call in the background, and a failed one could surface as an error] →
  The warmer owns the failure path; the wrapper only starts it, and a reported failure reaches the
  transcript as pi's does.
- [A structurally compared prefix can mismatch after compaction and stop warming] → The same rule
  pi applies, and stopping warming is the safe direction: no request is sent.
- [The location string can exceed the panel width for a long tenant name] → pi's panel does not
  wrap; the identity is bounded by the schema and the tenant the invocation chose.
- [Loading a user theme file executes nothing, but a malformed one could break startup] → pi's
  loader validates and reports diagnostics, and the loader is pi's, not ours.

## Open Questions

None.
