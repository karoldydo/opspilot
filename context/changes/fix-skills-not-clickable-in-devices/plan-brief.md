# Fix Custom Skills Not Appearing Per Service on /devices — Plan Brief

> Full plan: `context/changes/fix-skills-not-clickable-in-devices/plan.md`
> Research: `context/changes/fix-skills-not-clickable-in-devices/research.md` (its affordance framing is corrected below)

## What & Why

On `/devices`, every managed service row should render its in-scope skills as clickable buttons
that open the run-skill dialog. Today **no skill buttons render on any row**, so there is no way to
run a skill from the UI. The cause is a functional bug — not the styling regression the research
suspected.

## Starting Point

The skill data client, run-skill dialog, run store, API routes, device-scope SQL, and
satisfiability gate are all verified correct. But the skills are never fetched: the buttons are
absent from the DOM and `GET /api/skills?deviceId=` never fires.

## Desired End State

Each service row renders one clickable button per in-scope, satisfiable skill; clicking opens the
run dialog; `GET /api/skills?deviceId=` fires once per row. A component test guards the path, and
the buttons read as clickable per the mockup.

## Key Decisions Made

| Decision                         | Choice                                                            | Why (1 sentence)                                                                                  | Source |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| What the actual symptom is       | Buttons don't render at all (not an affordance issue)             | Confirmed live: zero skill buttons in DOM, `/api/skills` never fires.                             | Plan   |
| Root cause                       | Constructor reads required input `deviceId()` → NG0950 swallowed  | `load()` runs in constructor before inputs bind; throw caught by empty `catch`.                   | Plan   |
| Primary fix                      | Move load to a named `effect()`, pass `deviceId` in               | Effect runs after binding; mirrors the working `DeviceServicesComponent` pattern.                 | Plan   |
| Silent `catch`                   | Narrow it — isolate fetch errors, log/surface the rest            | The empty catch is exactly what hid this bug; keep row isolation but stop masking errors.         | Plan   |
| Regression guard                 | Add `service-skills.component.spec.ts` (render + click→dialog)    | No component spec exists today; a fetch-after-binding assertion would have caught this.           | Plan   |
| Affordance / styling             | Conditional Phase 3, shared terminal pattern (no `hlmBtn`)        | Button already matches working siblings; only sharpen if mockup review demands it.                | Plan   |

## Scope

**In scope:** `ServiceSkillsComponent` load timing + catch; a new component spec; an optional,
conditional button-affordance pass.

**Out of scope:** API, shared lib, data clients/stores, run dialog, scope SQL, satisfiability gate,
broad error-toast UX, terminal redesign.

## Architecture / Approach

Replace `constructor() { void this.load(); }` with a named `effect()` field that reads the bound
`deviceId()` and calls `load(deviceId)` — so the required input resolves and the fetch fires.
Narrow `load()`'s `catch` to keep the row resilient to real fetch failures while logging instead of
silently swallowing. Add the missing component spec. Review the rendered buttons against the mockup
and add a clickable affordance only if needed.

## Phases at a Glance

| Phase                                  | What it delivers                                          | Key risk                                                              |
| -------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Fix load timing + narrow catch      | Skill buttons render and the dialog opens                 | Effect must read the bound input post-binding (named field per rules) |
| 2. Component regression test           | Guard for the fetch-after-binding + click→dialog path     | Test must fail on the pre-fix code, not be a tautology                |
| 3. Button affordance (conditional)     | Mockup-faithful clickable styling, if needed              | May be unnecessary — skip if flat styling already matches mockup      |

**Prerequisites:** Local dev app runnable (`npm start`), logged-in session, seeded skills (present).
**Estimated effort:** ~1 session across 3 small phases (Phase 3 likely trivial or skipped).

## Open Risks & Assumptions

- Assumes the only blocker is the constructor input-timing throw; live evidence (no `/api/skills`
  request, no `?deviceId=undefined`) strongly supports this.
- Phase 3 may be a no-op if the existing flat terminal styling satisfies the mockup.
- The narrowed `catch` should keep per-row isolation (a fetch failure must not break the row).

## Success Criteria (Summary)

- Every service row on `/devices` shows clickable skill buttons that open the run dialog.
- `GET /api/skills?deviceId=` fires once per row; no `NG0950` in the console.
- A component spec asserts the render + click→dialog path and fails against the pre-fix code.
