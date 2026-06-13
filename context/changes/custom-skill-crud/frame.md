# Frame Brief: Custom skill CRUD (S-08)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Roadmap slice **S-08**: a user can define, edit and delete skills (parameterized
commands) with a **global** or **per-device** scope; the agent executes a skill
**deterministically** on a selected service and **sees only the skills proper to
the given device** (FR-006, FR-008). Full FR-006 + FR-008 in one slice.

## Initial Framing (preserved)

- **User's stated cause or approach**: "skill-as-data" — add a persisted `skill`
  table, a `@opspilot/shared` contract set, a NestJS CRUD module, a web feature,
  and route execution through the rows while preserving the "predefined skills
  only" guardrail (the CRUD vertical-slice blueprint from `research.md`).
- **User's proposed direction**: implement the slice on the well-trodden CRUD
  pattern; the 6 open questions in research (execution path, parameterization,
  defaults-as-rows, ephemeral-vs-persisted, injection contract, uniqueness) are
  the real design forks.
- **Pre-dispatch narrowing**: scope = **full FR-006 + FR-008**; leading risk =
  **execution-path shape** (AI-SDK tool-calling vs HTTP-only); defaults =
  **seed all 7 as rows** (later revised — see Reframe).

## Dimension Map

The observation could originate at any of these dimensions (focus: execution path):

1. **Invocation layer** — LLM tool-calling (`generateText` + `tool()`, the model
   picks skill + params) vs deterministic dispatch (route/user picks, no LLM in
   the execute path).  ← initial leading framing
2. **Meaning of "deterministically"** — does "the agent executes it
   deterministically" *require*, *permit*, or *forbid* probabilistic LLM
   tool-choice? (tension with load-bearing Non-Goal "no free-form prompts")
3. **"sees only this device's skills" (FR-008)** — does it imply a per-device
   filtered tool registry (needs tool-calling), or is it a plain query-time scope
   filter (works HTTP-only)?
4. **Defaults-as-rows** — do diagnoseLogs (streamObject) and scanServices (hidden,
   output-parsing) fit a uniform `{ command template, params }` row, given the
   user wants defaults seeded as rows?

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| "deterministically" **requires** LLM tool-calling | PRD load-bearing Non-Goals `prd.md:127,129` + Guardrail `:43` + FR-008 "user runs a skill on a selected service" / "deterministically"; only AI-SDK use is `streamObject` (`diagnose.service.ts:109-115`), no `tool()`/`generateText` anywhere | **NONE / contradicted** |
| Deterministic dispatch, HTTP-only (mirror S-06 operations) | S-06 path is 1:1 template: `operation.controller.ts:16-22` → `operation.service.ts:39-82` (`buildCommand` + charset re-parse) → `executor.execute(deviceId, command, timeoutMs)` `executor.interface.ts:19`; enum guardrail `service-operation.schema.ts:3-7`; LLM-free | **STRONG** |
| "sees only this device's skills" requires a tool registry | S-07 injects per-device data as model `system` text, **not** a tool (`diagnose.service.ts:108-115`); per-device filter is plain `eq(service.deviceId, deviceId)` (`service.service.ts:61,167`); `or(isNull, eq)` global+device predicate is absent everywhere (greenfield), feeds either a tool-map or an HTTP listing | **WEAK** (tool-registry not required) |
| All 7 defaults fit one uniform row shape | 5 lifecycle ops (`operation.service.ts:66-82`) + scanServices (`service.service.ts:30-33,47-58`, command+JSON-parse) are plain; **diagnoseLogs is not** — `docker logs` *then* `streamObject` (`:109-115`) + SSE + `RunRecord` persistence (`:129`) | **NONE** (uniformity breaks on diagnoseLogs) |

## Narrowing Signals

Decisive observations that narrowed the hypothesis space:

- `vercel-ai-sdk.md:18` literally says "use `generateText` + tool-calling for skill
  execution", but `:19-20` bounds it to "no free-form entry point, predefined,
  device-scoped". This is a tool *mechanism* mandate, **not** "the LLM chooses the
  skill/params" — determinism is not achieved by model tool-choice.
- User decision: **pure HTTP deterministic dispatch; defer the agent-shell to v2**
  — treat `vercel-ai-sdk.md:18` as a v2 (chat) direction, FR-008's "agent-first
  from day 0" is honored later without a refactor.
- User decision (defaults model): deferred to frame's recommendation.
- diagnoseLogs already exists and works (S-04/S-05); forcing it into the skill row
  would reimplement `streamObject` + SSE + `RunRecord` and brush the S-09
  persistence boundary that `deterministic-service-operations` explicitly re-deferred.

## Cross-System Convention

Deterministic command execution in this codebase is **always LLM-free**: the S-06
operation path (request → enum/row guardrail → fixed/rendered template → executor)
is the established convention, and the only AI-SDK call (`streamObject` in diagnose)
is structured *synthesis* (FR-009), not skill dispatch. The leading hypothesis
(HTTP-only deterministic dispatch, user selects the skill) matches the convention
exactly. The S-05 lesson — "name neutrally, do not abstract until a second instance
makes the shared shape real" — supports keeping diagnoseLogs a built-in rather than
introducing a `kind` discriminator for one special case.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: build the skill-as-data table + CRUD +
> **deterministic, per-device-scoped HTTP execution** (mirroring the S-06 operation
> path), whose single genuinely-new load-bearing control is a **safe parameterized
> command renderer** (typed placeholders + charset-reparse at the shell boundary) —
> *not* an LLM tool-calling layer.

The initial framing's CRUD-vertical-slice core **held up**. Two sub-framings were
corrected by the evidence: (1) the "AI-SDK tool-calling vs HTTP-only" item was not
an open binary — the PRD's load-bearing Non-Goals already mandate deterministic,
user-selected dispatch, and the user has locked **pure HTTP** (agent-shell → v2);
(2) "seed all 7 defaults as uniform rows" breaks on diagnoseLogs. Addressing the
real problem means the plan centers the parameterized-command security contract and
the `or(isNull(deviceId), eq(deviceId, X))` scope filter, and treats diagnoseLogs
(and scanServices's output-parsing) as special-case built-ins outside the uniform
shell-skill row.

## Confidence

- **HIGH** — strong, convergent evidence (4 independent probes), matches the S-06
  convention, decisive narrowing signals, and the user has locked the execution
  path. The only MEDIUM-confidence element is the *future* agent-shell direction
  (v2), which is explicitly out of this slice's scope.

## What Changes for /10x-plan

The plan is **not** about an AI-SDK tool registry. It is about: (1) a `skill` table
(nullable `deviceId` = global) + shared contract trio + thin CRUD module + web
feature on the device/llm-provider blueprint; (2) a **parameterized-command schema
in `@opspilot/shared`** (the load-bearing injection control — placeholder grammar +
charset-constrained params, mirroring `container-name.schema.ts`); (3) a
deterministic HTTP run endpoint mirroring `operation.service.run` with an
`or(isNull(skill.deviceId), eq(skill.deviceId, deviceId))` scope check; (4) seed the
**5 lifecycle ops** as global rows; **keep diagnoseLogs and scanServices as built-ins**
(no `kind` discriminator yet, no `RunRecord` for skill runs — stay ephemeral, respect
the S-09 boundary). Still-open detail-level questions for /10x-plan: exact placeholder
grammar, per-skill `timeoutMs` (config-not-const), and name-uniqueness-per-scope
(one transaction if enforced).

## References

- Source files: `apps/api/src/operation/operation.service.ts:39-82`,
  `operation.controller.ts:16-22`, `executor/executor.interface.ts:19`,
  `executor/ssh.executor.ts:30-80`,
  `libs/shared/src/lib/schemas/service-operation.schema.ts:3-7`,
  `apps/api/src/diagnose/diagnose.service.ts:49,55,108-115,129,169-171`,
  `apps/api/src/service/service.service.ts:30-33,47-58,61,167`,
  `.claude/rules/vercel-ai-sdk.md:18-22`,
  `context/foundation/prd.md:82,84,88,127,129,43`
- Related research: `context/changes/custom-skill-crud/research.md`
- Investigation: 4 parallel read-only sub-agents (deterministic-requires-tool-calling;
  HTTP-only-dispatch; per-device-filter-needs-tool-registry; defaults-uniformity)
