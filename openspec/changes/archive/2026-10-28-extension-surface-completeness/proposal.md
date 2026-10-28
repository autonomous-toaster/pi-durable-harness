# Extension Surface Completeness

## Why

The extension host reached the durable primitives but only hosted 9 of pi's 41 events plus the registrars, so a user with four ordinary extensions saw 29 stderr diagnostics at every startup (`session_start`, `agent_start`, `turn_start`, `message_*`, `tool_execution_*`, `registerEntryRenderer`, ...). Most of those surfaces already had a seam: the harness projects the durable event stream into pi's events and owns every RPC command that pi emits the rest from. The claim "unhosted" was true of the translator, not of the harness.

## What Changes

- Dispatch extension handlers from the projected session stream: `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`/`_update`/`_end`, `agent_before_settle`, `agent_settled`, `session_start`, `session_shutdown`, `session_compact`.
- Dispatch from the RPC commands the harness owns: `model_select`, `thinking_level_select`, `session_info_changed`, `session_tree`, `user_bash`, and `input` (whose `text` result replaces the message before the model call).
- Serialize dispatch, so handlers observe events in session order, and contain a throwing handler to a diagnostic instead of ending the run.
- Give the `pi.*` action surface durable-backed implementations (`sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`, `getActiveTools`, `getAllTools`, `setActiveTools`, `getSettings`, `getCommands`, `setModel`, `getThinkingLevel`, `setThinkingLevel`) and an inert `ctx.ui`, so a handler that acts works instead of hitting the loader's pre-bind stub. Provide a synchronous `ctx.sessionManager` over a snapshot refreshed before each dispatch.
- Apply `registerFlag` from the process arguments and `resources_discover` by re-reading skills and templates with the discovered paths.
- Classify in three classes instead of two: **hosted**, **inert** (renderer registrations, shortcuts, `ui_prompt_*`, and `ctx.ui` — accepted with no effect, exactly as pi degrades them in RPC mode), and **unhosted** (only the provider-level events with no durable counterpart). An unapplied handler result is reported, never dropped.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pi-extension-host`: the hosted set grows from hooks and registrars to the dispatched events, the action surface, flags, and resource discovery; the classification becomes three classes; a result the harness cannot apply must be reported.
- `failure-diagnostics`: an inert surface is accepted silently, and a diagnostic covers an unapplied handler result as well as an unhosted surface.

## Impact

- **Code**: add `src/extensions/events.ts` (dispatch bus) and `src/extensions/actions.ts` (durable-backed `pi.*` actions and `ctx.sessionManager`); rework the classifier in `src/extensions/host.ts`; wire dispatch into `src/rpc/session.ts` (submit, bash, model, thinking, session-name, fork/clone/switch, the event stream) and `src/index.ts` (bus construction, flag application, resource discovery, shutdown).
- **Behavior**: the four extensions on the developer machine go from 29 startup diagnostics to none, and the skills bundled by an extension package appear in `get_commands`.
- **Risk**: extensions now run user code in the event path; a throw is contained to a diagnostic, and dispatch is serialized so ordering matches the session.
