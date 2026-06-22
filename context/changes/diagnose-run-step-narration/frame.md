# Frame Brief: Diagnose run-step narration

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

When watching a live diagnose run, the terminal panel **sits idle/empty during the
run and the result only appears after it's done** ("nic do samego końca") — it does
not visibly tick through anything. The mockup (`mockups/index.html` `buildNarration()`)
depicts a step-by-step agent run log that the live terminal never produces.

## Initial Framing (preserved)

- **User's stated cause or approach**: It's a backend/contract gap —
  `runNarrationEventSchema` has no "execution step" frame, so the terminal has nothing
  to render as steps. Fix by adding a `step` variant to the discriminated union.
- **User's proposed direction**: Add `{ type: 'step', kind, text }` to the shared union,
  emit `step` frames at real execution milestones in `diagnose.service.ts`, accumulate a
  `steps[]` slice in `DiagnosisStore`, render them in the terminal with a
  kind→prefix/color map.
- **Pre-dispatch narrowing**: Observation = **"nic do samego końca"** (idle until the
  end — NOT "synthesis fills progressively", which is what the research assumed the code
  does). Fidelity = initially "dopasuj rytm mockupu, linie kosmetyczne OK". Need =
  "dawać poczucie żywości". (Post-evidence, the user revised the direction — see
  Narrowing Signals.)

## Dimension Map

The observation could originate at any of these dimensions:

1. **Contract shape** — no `step` member in the SSE union, so steps cannot be rendered. ← initial framing
2. **Backend signal availability** — the execution does not naturally produce a sequence of observable milestones (SSH connect/auth opaque; container/device/provider resolved pre-flight).
3. **Dead-air window** — a stretch of wall-clock between stream-open and first frame during which the renderer receives nothing it draws.
4. **Temporal distribution of steps** — even if emitted honestly, where do the steps fall on the timeline? (burst vs sustained)
5. **Mockup fidelity vs reality** — the mockup's "alive" feel may be a presentation artifact, not a property of real step timing.
6. **Existing liveness mechanisms** — `delta` partial stream + blinking caret already exist; do they cover the felt gap?

## Hypothesis Investigation

| Hypothesis                           | Evidence                                                                                                                                                                                              | Verdict                             |
|--------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------|
| D1: Contract lacks a `step` frame    | `run-narration-event.schema.ts:17-31` is a 3-member union; adding a 4th is a one-line edit                                                                                                            | TRUE but **trivial & insufficient** |
| D2: Honest signals are sparse        | Container/device/provider resolved pre-flight (`diagnose.service.ts:41-51`); SSH connect/auth opaque (`ssh.executor.ts:43`); ~half mockup lines unbacked (research §2)                                | STRONG                              |
| D3: Real dead-air window exists      | Zero `delta`/`done` frames between HTTP 200 (`:68`) and first `delta` (`:109`); `ping` is a named event `onmessage` ignores (`diagnosis.client.ts:38`)                                                | STRONG                              |
| D4: Long pole = model inference      | `LLM_GENERATE_TIMEOUT_MS=120000` in deployed `.env`; SSH+logs = sub-second to ~2s; `done` waits on `await object` (`:111`)                                                                            | STRONG                              |
| D5: Honest ticker = burst-gap-burst  | 5–6 lines fire at t≈0; the `for await` at `:105` blocks on model TTFT producing **no** step line; mockup pacing is a fixed `setTimeout(tick,300)` over a literal array (`mockups/index.html:989-996`) | STRONG                              |
| D6: Existing liveness covers the gap | `delta` stream + caret only start **after** model TTFT (same `:105` point); caret is the *only* thing animating during the silent inference window                                                    | PARTIAL — caret yes, content no     |

## Narrowing Signals

Decisive observations that narrowed the hypothesis space:

- User's lived observation is **"idle until the end"**, not "synthesis fills progressively" —
  contradicting the research's assumption and pointing straight at the dead-air window (D3).
- Both verification agents returned **STRONG** independently: the dead air is real (agent A)
  and a discrete step ticker would be burst-gap-burst (agent B).
- The mockup's liveness is a **300 ms artificial timer over a hardcoded array** — it
  structurally cannot represent the real gap, so faithfully reproducing it as honest steps
  is impossible; reproducing its *feel* requires either artificial pacing or an ambient filler.
- **Decisive reframe choice**: presented with the evidence, the user chose **"honest content
  + ambient filler"** — real lines only (no fake step text) PLUS a continuous element
  (elapsed timer / animated caret / "analyzing… Xs") to fill the inference window. This
  reconciles the "feel alive" goal with `change.md`'s honesty rule **without relaxing it**.

## Cross-System Convention

The codebase already holds the honest-liveness building blocks: the `delta` partial-object
stream (real, but only post-TTFT) and the `animate-op-blink` caret
(`diagnose-hero.component.html:49-54`, the sole animation during inference). The heartbeat
`ping` is deliberately invisible to the renderer (keep-alive only). The convention is "render
only what's real" — the ambient filler must therefore be a *derived-but-true* signal (elapsed
time, current phase), not fabricated step text. This matches `change.md`'s honesty constraint.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the diagnose terminal feels dead during the
> long (~120 s) model-inference window, and discrete real-execution steps cannot fill it —
> so the change is **(a)** an honest `step` frame for the opening milestones **plus (b)** an
> ambient, continuously-updating liveness element for the inference gap — not merely "add a
> step frame".

The original framing ("the contract lacks a step frame") is *true but addresses only the
opening sub-second*. Adding the `step` frame and emitting honest milestones produces a burst
of ~5–6 lines in the first <1 s, then the same dead air during model inference, then the
result — the felt problem ("nic do samego końca") survives. What actually changes the
experience is filling the inference window with a derived-but-true ambient signal (elapsed
timer / phase indicator / live caret), alongside (not instead of) the honest steps. The
honesty constraint in `change.md:67-70` stays intact — the user explicitly chose honest
content over mockup theatre.

## Confidence

- **HIGH** — both verification agents returned STRONG with concrete `file:line` evidence;
  deployed `.env` confirms the 120 s inference pole; the reframe decision was ratified by the
  user against the new evidence; the chosen direction (honest + ambient) needs no relaxation
  of the existing guardrail.

## What Changes for /10x-plan

Plan two cooperating pieces, not one: **(1)** the additive `step` frame + honest milestone
emission (cmd, connecting, fetching, received N lines/KB, analyzing with model·provider,
synthesizing, done) — the opening-burst narration; and **(2)** an ambient inference-gap
liveness element (e.g. an elapsed-time/"analyzing… Xs" line or an enhanced caret) that updates
continuously while the model thinks. Explicitly **out of scope**: artificial mockup-style 300 ms
paced reveal and any cosmetic/fabricated step text — the honesty rule holds. Note for planning:
the heartbeat `ping` is invisible to `onmessage`, so any ambient signal that must reach the UI
needs a real rendered frame (or a client-side timer), not the existing keep-alive.

## References

- Source files: `apps/api/src/modules/diagnose/diagnose.service.ts` (stream `:68`, first
  `delta` `:109`, `streamObject` `:97-103`, pre-flight `:41-51`),
  `apps/api/src/integrations/executor/ssh.executor.ts:43`,
  `apps/web/src/app/features/diagnosis/data/diagnosis.client.ts:38`,
  `apps/web/src/app/features/diagnosis/diagnose-hero.component.html:49-54`,
  `libs/shared/src/lib/schemas/run-narration-event.schema.ts:17-31`,
  `apps/api/src/config/env.schema.ts` + deployed `.env` (`LLM_GENERATE_TIMEOUT_MS=120000`),
  `mockups/index.html:917-948,989-996`.
- Related research: `context/changes/diagnose-run-step-narration/research.md`
- Investigation agents: "Trace diagnose stream dead-air window" (STRONG), "Check if step
  ticker fills the silence" (STRONG).
