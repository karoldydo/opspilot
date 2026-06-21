---
change_id: diagnose-run-step-narration
title: Stream real-time agent run-step narration into the diagnose terminal
status: new
created: 2026-06-21
updated: 2026-06-21
archived_at: null
---

## Notes

Add a real-time "agent run steps" narration stream to the diagnose flow so the terminal
panel ticks through the actual execution steps — not just the synthesis content.

### Why (origin)

Surfaced while closing the `web-terminal-design-system` change (Phase 6, diagnose-hero).
The mockup's terminal panel shows a **step-by-step agent run log** (see
`mockups/index.html` `buildNarration()` around lines 917-948), e.g.:

```
$ opspilot diagnose bitwarden@synology-nas        (kind: cmd,    prefix $)
· connecting to synology-nas:22 via ssh           (kind: sys,    prefix ·)
+ authenticated as ops (ed25519 key)              (kind: ok,     prefix +)
· resolving container bitwarden                    (kind: sys)
· fetching last 200 log lines                      (kind: sys)
+ received 200 lines (18.4 KB)                      (kind: ok)
· loading device context                           (kind: sys)
· analyzing with claude-opus-4.5 · OpenCode Zen    (kind: sys)
! pattern detected: ENOSPC — write-ahead log ...   (kind: warn,   prefix !)
· synthesizing assessment                          (kind: sys)
= done in 11.3s — status: DEGRADED                 (kind: result, prefix =)
```

Steps appear sequentially over time, each with a kind → prefix (`$`/`·`/`+`/`!`/`=`)
and a color, plus a blinking caret while running.

The current diagnose-hero (built in Phase 6 of `web-terminal-design-system`) only renders
the **synthesis** (`problems`/`suggestions`/`summary`) in a terminal-ish panel, because
that is all the stream provides. The run-step narration the mockup shows has **no backing
data** today. Phase 6 was intentionally closed as "render the single synthesis in terminal
style"; this run-step narration is the deferred follow-up.

### The backend gap (the real problem)

`GET /api/devices/:deviceId/services/:serviceId/diagnose/stream` only emits synthesis
frames. `runNarrationEventSchema` (`libs/shared/src/lib/schemas/run-narration-event.schema.ts`)
is a discriminated union of exactly three frame types:
- `delta`  — progressive partial of the 4-field `diagnosisSynthesisSchema`
- `done`   — the persisted `RunRecord` (prepended to the FE recent list)
- `error`  — stable error code + message

There is **no** "execution step" frame. So the terminal cannot tick through run steps —
it can only watch the synthesis object fill (problems → status → suggestions → summary, in
schema order), which is not what the mockup depicts.

### Proposed shape (contract-first; refine in /10x-research + /10x-plan)

1. **`@opspilot/shared`** — add a new variant to `runNarrationEventSchema`, e.g.
   `{ type: 'step', kind: 'cmd' | 'sys' | 'ok' | 'warn' | 'result', text: string }`
   (Zod v4 `z.strictObject`, one export per file per zod.md; single FE↔BE contract per
   contracts.md). Keep `delta`/`done`/`error` unchanged so the synthesis stream is
   backward-compatible.
2. **`apps/api` `diagnose.service.ts`** — emit `step` frames at the real execution
   milestones around the existing flow (SSH connect, container resolve, fetch N log lines
   / KB received, "analyzing with <model> · <provider>", synthesizing, "done in Xs —
   status: …"). These must be **real** signals derived from actual execution — the SSH
   executor (`ssh.executor.ts`), the actual line/byte counts fetched, the resolved LLM
   model/provider from config — NOT hardcoded placeholder strings (the mockup's text is an
   example, not the contract). The `streamObject()` synthesis lives at
   `diagnose.service.ts:94-114` per the prior plan; steps wrap/precede it. Heartbeat +
   SSE conventions per sse.md (`: ping`, `X-Accel-Buffering: no`, `Cache-Control: no-cache`).
3. **`apps/web`** — `DiagnosisStore`
   (`apps/web/src/app/features/diagnosis/data/diagnosis.store.ts`) accumulates a `steps[]`
   slice from `step` frames (alongside the existing `partial`/`result`/`runs`). The
   diagnose-hero terminal panel
   (`apps/web/src/app/features/diagnosis/diagnose-hero.component.{ts,html}`) renders the
   steps sequentially with the kind → prefix/color mapping and a blinking caret while
   loading. The structured synthesis card stays as the settled result below the terminal.

### Constraints / guardrails

- Zod-first single source of truth in `@opspilot/shared`; both apps consume via `z.infer`
  (contracts.md). No parallel FE/BE types.
- Respect `@nx/enforce-module-boundaries` (scope:api → scope:api + scope:shared;
  scope:web → scope:web + scope:shared).
- Operational tunables (e.g. any new timeouts) go through the config layer, never in-file
  `const`s (lessons.md). NestJS DI via explicit `@Inject(...)` tokens (lessons.md).
- The diagnose stream must still persist the synthesis + `durationMs` and still emit
  `done`/`error` exactly as today — steps are additive, not a rewrite.
- No remediation / "apply" action — out of scope, same as the parent change.

### Open questions for research/planning

- Do existing diagnose unit/integration tests assert the exact frame set? (They must be
  updated to tolerate/assert the new `step` frames.)
- Should step text be localized/styled FE-side from a structured `kind` + small payload,
  or sent as ready-to-render `text`? (Leaning: send structured `kind` + `text`, let FE
  own the prefix/color map — keeps the contract thin and the styling in the design layer.)
- Replayed runs (from `findRecent`) have no step history (steps are ephemeral, not
  persisted). The terminal should show steps only for a live re-run; replayed runs show
  the settled synthesis only. Confirm this is acceptable.

### Key references

- Mockup narration: `mockups/index.html` `buildNarration()` (~917-948), `mkLine()` (~894),
  terminal variant render (~308-345).
- Stream contract: `libs/shared/src/lib/schemas/run-narration-event.schema.ts`,
  `diagnosis-synthesis.schema.ts`, `run-record.schema.ts`.
- API: `apps/api/src/modules/diagnose/{diagnose.controller,diagnose.service}.ts`,
  `ssh.executor.ts`.
- Web: `apps/web/src/app/features/diagnosis/data/{diagnosis.store,diagnosis.client}.ts`,
  `diagnose-hero.component.{ts,html}`.
- Parent change: `context/changes/web-terminal-design-system/` (Phase 6 closed the
  diagnose-hero with synthesis-only terminal; this change adds the run-step narration).
