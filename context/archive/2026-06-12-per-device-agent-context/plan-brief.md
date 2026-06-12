# Per-device agent context (FR-005 / S-07) — Plan Brief

> Full plan: `context/changes/per-device-agent-context/plan.md`
> Frame brief: `context/changes/per-device-agent-context/frame.md`
> Research: `context/changes/per-device-agent-context/research.md`

## What & Why

Give the user one host-level free-text field on the `device` entity that is injected as
`system` context into the diagnostic agent, so diagnoses respect that host's shared
conventions (path conventions, privileged-access needs, availability hours). Today the
agent runs identically on every host and gives generic answers because it doesn't know a
host's conventions.

## Starting Point

The device entity carries only `id/name/host/timestamps`; there is no context column and
the diagnose agent has no `system` parameter — `narrate()` loads only the *service* row
and `DiagnoseService` can't even reach `DeviceService` (`DeviceModule` isn't imported).
Every layer (DB schema, shared contracts, device service projection, web form) already
has a clean, established pattern to extend.

## Desired End State

A device's edit form has an "Agent context" multi-line field. What the user types persists
on the device, returns on every read, and — when non-empty — becomes the `system`
instruction for every diagnosis on that host. Blank keeps today's behaviour exactly.

## Key Decisions Made

| Decision               | Choice                                      | Why (1 sentence)                                                              | Source   |
| ---------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| Entity granularity     | `device` (host-level)                       | Conventions are shared by all containers on a host; FR-005 mandates device.   | Frame    |
| Content shape          | Free-text persona only                      | Per-service path data already lives in `service.composePath` — keep separate. | Frame    |
| Injection mechanism    | AI SDK `system` slot                        | Conventional home for per-host persona; leaves the fixed synthesis schema untouched. | Research |
| Empty-context handling | Omit `system` when null/empty/whitespace    | No regression to the existing flow when the field is unused.                  | Frame    |
| Field name             | `agentContext` (column `agent_context`)     | Descriptive, matches the feature; avoids generic `context` / impl-bound `systemPrompt`. | Plan     |
| Max length             | `4000` chars, literal in shared schema      | ~1k tokens is a sensible prompt; the bound is a shared contract, not a config tunable. | Plan     |
| Persist in run record  | Deferred                                    | Run records carry only synthesis; transcript-replay of context is FR-010/011. | Frame    |

## Scope

**In scope:** nullable `agent_context` column + migration; `agentContext` in shared
create/response contracts; device-service projection; `DeviceService` wired into
diagnose; `system` injection; web form textarea.

**Out of scope:** per-service or per-user context; folding `composePath` structured data
into this field; persisting context into the run record; a config-layer max-length knob.

## Architecture / Approach

A single nullable text field threaded along the existing device CRUD path
(DB → `@opspilot/shared` → `device.service` projection → web form), then consumed at one
injection point: `narrate()` loads the device, threads its trimmed context to the
`streamObject` call, and passes it as `system` only when non-empty. FE validation and BE
boundary parsing come "for free" from the single shared schema.

## Phases at a Glance

| Phase                       | What it delivers                                          | Key risk                                                        |
| --------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Storage & contract       | Column + migration + shared contracts + service projection | Forgetting one of the three projection whitelists drops the field silently |
| 2. Diagnose agent injection | `DeviceModule` wired in; `system` injected when non-empty | DI: explicit `@Inject(DeviceService)` (esbuild drops paramtypes); empty-context guard |
| 3. Web devices form         | "Agent context" textarea, validated + patched + submitted | Sending `''` instead of `null` on a cleared field              |

**Prerequisites:** S-01 (manage-devices) + S-04 (diagnose-service-synthesis) — both done.
**Estimated effort:** ~1 session across 3 phases (LOW complexity).

## Open Risks & Assumptions

- `diagnose.service.spec.ts` must add a `DeviceService` mock/provider or DI fails — update with Phase 2.
- Devices have no `userId`; the context is shared across all users (no per-user override) — acceptable per the manage-devices design.
- The 4000-char bound is assumed sufficient for host conventions; revisit only if users hit it.

## Success Criteria (Summary)

- A diagnosis on a device with `agentContext` set respects the stated host convention.
- A diagnosis on a device with empty/null context behaves exactly as before, within the < 15 s NFR.
- The field round-trips through create/edit and validates the 4000-char bound at the form.
