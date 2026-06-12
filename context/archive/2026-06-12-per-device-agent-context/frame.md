# Frame Brief: Per-device agent context (FR-005 / S-07)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

The diagnostic agent runs the same way on every host, but different hosts have
different conventions (path conventions, privileged-access requirements,
availability hours). Roadmap S-07 / FR-005: a user should be able to shape the
diagnostic agent's behaviour per host. The leading concern is **diagnosis
accuracy** — the agent gives generic/ill-fitted answers because it does not
know a given host's conventions.

## Initial Framing (preserved)

- **User's stated cause or approach**: a single optional free-text "system
  prompt" field on the `device` entity, injected into the diagnose agent's LLM
  call via the AI SDK `system` parameter.
- **User's proposed direction**: thread the field end-to-end (DB column →
  shared contract → API → web form) and inject as `system`.
- **Pre-dispatch narrowing**: leading observation = "agent guesses per host"
  (accuracy); scope = "one thing — prompt shape" (free-text persona, not bundled
  structured fields). Granularity in the abstract round was answered "per
  service", which **contradicted** the device-level framing and triggered the
  investigation below.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Entity granularity** — does the context belong to `device` or `service`?  ← the contested node
2. **Content shape** — one free-text blob vs structured fields  *(resolved: free-text persona; paths stay structured/separate)*
3. **Injection mechanism** — AI SDK `system` vs concat into `buildPrompt`  *(solution detail, deferred to plan)*
4. **Hardness of "per-device"** — does PRD/roadmap mandate device, or is it just the slice's original wording?

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Field belongs on `service` (per-container conventions) | `diagnose.service.ts:42` `narrate(deviceId, serviceId)` loads the **service** row, not device; `service` has full CRUD + `toContract` (`service.service.ts:177`) → structurally a *clean* attach point | STRONG (structure) but **refuted by user** below |
| Field belongs on `device` (host-level conventions) | `prd.md:78` FR-005 "per-**device** system prompt"; `roadmap.md:208` "different **hosts** have different conventions"; device has no `userId` (shared) | STRONG |
| "per-device" is a hard requirement, not loose wording | FR-005 + S-07 both state device-level explicitly; no open question anywhere proposing per-service | STRONG |
| Content is one free-text persona, not bundled structured data | User narrowing answer #3; `composePath` already exists **per-service** (`service.schema.ts`) for path conventions used by up/down — a *separate* concern | STRONG |

## Narrowing Signals

- **Decisive (Step 4):** asked concretely — "one host with Plex + Postgres:
  same agent context for both, or different per container?" → **"the same for
  both."** The abstract "per service" answer did not survive a concrete
  two-container example. Conventions that feed the diagnostic agent are
  **host-level**, shared by every container on the host.
- The three FR-005 examples are mixed-granularity *as data* (paths are already
  per-service via `composePath`; availability hours are host-level), but the
  **free-text agent persona** this feature adds is host-level — which is why the
  user's "same for both" answer is consistent with `composePath` living
  elsewhere.

## Cross-System Convention

Structured per-service path data already lives on `service` (`composePath`,
populated by scan, consumed by up/down). The new free-text agent persona is a
different kind of thing — a host-level instruction blob — and the AI SDK
`system` slot is the conventional home for per-host persona/conventions. The two
do not belong in the same field.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: give the user one host-level
> free-text field on the `device` entity that is injected as `system` context
> into the diagnostic agent, so diagnoses respect that host's shared conventions.

The initial framing was **correct** — proceed with the originally proposed
direction (device-level field, AI SDK `system` injection). The per-service
hypothesis looked structurally cleaner in code, but the user confirmed
conventions are shared across all containers on a host, so device is the right
granularity and matches FR-005. No reframe of the entity is warranted.

**The one boundary this frame adds:** this field is **not** the place for
per-service path conventions. Those already live in `service.composePath`. The
plan must not let "agent context" absorb per-service structured data — keep it a
host-level persona blob.

## Confidence

- **HIGH** — strong requirement evidence + matches convention + a decisive,
  concrete narrowing signal that resolved the only contested dimension.

## What Changes for /10x-plan

Plan stays as the research describes: device-level nullable text field threaded
end-to-end, injected via `system`. The frame adds one guardrail (keep it a
host-level free-text persona; do not fold per-service path data into it) and
hands the remaining items to the plan as **solution** decisions, not framing
ones: field name, max-length bound (config-layer tunable per `lessons.md`),
`system` vs concat, persist-in-run-record (defer unless audit needs it), and
null/empty-context handling (omit `system` when empty).

## References

- Source files: `apps/api/src/diagnose/diagnose.service.ts:42,99-104`;
  `apps/api/src/database/schema/device.schema.ts:6-17`;
  `apps/api/src/database/schema/service.schema.ts` (`composePath`);
  `apps/api/src/service/service.service.ts:177`
- Requirements: `context/foundation/prd.md:78-79` (FR-005);
  `context/foundation/roadmap.md:199-209` (S-07)
- Related research: `context/changes/per-device-agent-context/research.md`
