## 1. Theme flags (spec: `cli-prompt-modes`)

- [x] 1.1 Read `--theme` as a repeatable path, resolving each value against the working directory. Verify a test reads two values and resolves both, and a test reports a path that names nothing
- [x] 1.2 Read `--no-themes` as a switch. Verify a test sets the switch and `--help` lists it
- [x] 1.3 Read `--use-theme <name>`. Select the name through the settings override before the session opens. Verify a test selects the name, and a test refuses the flag with no value and names it
- [x] 1.4 Pass the resolved theme paths and the switch to both resource-loader constructions. Verify a test loads a theme file from `--theme` through the loader, and a test with `--no-themes` still loads a requested theme

## 2. Themes in the interface (spec: `tui-parity`)

- [x] 2.1 Hand pi's interface the loader that carries the extra themes. Verify a run with `--theme` lists the loaded theme beside the built-ins, compared with pi on the same file
- [x] 2.2 Start the interface on the selected theme, and on the stored theme when no flag arrived. Verify an A/B run reports the same active theme as pi for both cases

## 3. Cache warming (spec: `tui-parity`, `pi-extension-host`, `transcript-projection`)

- [x] 3.1 Construct pi's warmer from the session's model runtime, the settings' warming mode, and the projected branch. Verify a session reports a warming state other than unavailable
- [x] 3.2 Start warming on every session request at the runtime durable is given, using pi's currency rule. Verify a recorded request arms a refresh, and a request after a fork does not restart from the old prefix
- [x] 3.3 Settle, cancel, and reconcile the warmer with the turn and with a mode change Verify a settled turn schedules a refresh, a cancelled run stops one, and a mode change reaches the warmer
- [x] 3.4 Answer `cacheWarmingStatus` from the warmer. Verify `/session` prints pi's Cache Warming block instead of unavailable, and a settled turn and a changed mode both reach the warmer
- [x] 3.5 Record a refresh as a control entry and project it as pi's warm line, including its cost in the session total. Verify the transcript shows the warm line and `/session` cost counts the warm
- [x] 3.6 Apply an extension's `cache_warming_decision` action. Keep the warmer's decision when no handler exists or a handler fails. Verify a handler answering `stop` ends warming and a failing handler uses pi's decision
- [x] 3.7 Compare the Cache Warming block with pi on a warmed run. Verify the labels and values match field for field

## 4. Session location (spec: `tui-parity`, `rpc-parity`)

- [x] 4.1 Produce the session location in one function. Read the location from that function on both surfaces. Verify a test asserts the panel value and the RPC answer are the same string
- [x] 4.2 Report a path for a local session and the storage identity for a PostgreSQL session. Verify a test covers both, and a test keeps an ephemeral session without a location
- [x] 4.3 Keep RPC from answering `null` for a persisted session. Verify the test reads a persisted session in both backends

## 5. Documentation (spec: `cli-prompt-modes`)

- [x] 5.1 Document the three theme flags in the `--help` text and the README flag table, and remove the cache-warming limitation. Verify `--help` prints all three flags, and the README no longer calls cache warming unavailable
