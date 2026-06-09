# Frame Brief: F-02 account-auth-foundation — registration policy

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Roadmap slice **F-02 (`account-auth-foundation`)**: "a user can register, log
in, and hold a session; unauthenticated requests reach no operational function.
Flat model — no roles." F-01 (`data-persistence-scaffold`) is implemented and
leaves a clean seam; `research.md` deferred two design questions to this frame —
registration policy and the Cloudflare-Access-vs-app-session identity layering.

## Initial Framing (preserved)

- **User's stated cause or approach**: wire Better Auth (email+password, flat
  model) into NestJS+Drizzle + a global guard, plus an Angular guard/interceptor,
  exactly as `research.md` maps it.
- **User's proposed direction**: proceed to `/10x-plan` with the Better Auth
  integration as the F-02 scope, treating "register" as **open self-service
  signup**.
- **Pre-dispatch narrowing** (Step 1.5): leading concern = **registration
  policy**; "register" observed as **open self-service signup**; access boundary
  = **app guard (401), with Cloudflare Access as an optional edge**.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Registration policy** ← initial framing — assumes OPEN signup. A world-
   reachable `/api/auth/sign-up` + flat model = any outsider gets full
   operational access.
2. **Flat-model compatibility** — can controlled provisioning be done WITHOUT
   introducing roles? If not, "controlled registration" would conflict with the
   PRD "flat, no roles" premise.
3. **Identity layers / boundary** — Cloudflare Access (gate) vs app session
   (identity). Settled by PRD + user (Access = optional edge) → light verify.
4. **Integration mechanism** — prefix collision, migration path, body-parser.
   This is HOW (plan-level), already covered by `research.md` — out of frame
   scope.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| D1 — open signup is a *requirement* | Docs are SILENT on who may create an account: `prd.md:62-63` (FR-001) and `:119-121` (Access Control) require accounts to *exist*, not open creation. All user-base framing implies CONTROLLED: `prd.md:28` "small group of trusted users (family/housemates)", `:121` "small trusted group", `infrastructure.md:115` Access policy = "allowing the 1–few user emails". Open signup = unverified assumption. | NONE (for "required"); framing implies controlled |
| D2 — controlling signup forces roles | FALSE. Better Auth `emailAndPassword.disableSignUp: true` + server-side seed via `internalAdapter.createUser` / `databaseHooks.user.create.before` allowlist provisions accounts role-free. Only the `admin`/`organization` plugins introduce roles, and both are avoidable. Controlled provisioning is fully compatible with flat/no-roles. | NONE (conflict refuted) |
| D3 — Access is an optional edge, app guard is the boundary | STRONG. `prd.md:63`: "any external access layer is an optional edge in front of the application"; audit needs identity "independent of the deployment layer". Deploy reality: `deploy-plan.md:154` app live behind Access; `infrastructure.md:46,115` Access is a *hostname-level* gate (gates all routes incl. `/api/auth/*`), no documented route carve-out. | STRONG |

## Narrowing Signals

- **User confirmed (Step 4): open signup stays** — rejected the "controlled
  provisioning" reframe.
- **User-supplied deployment context (decisive)**: the app is *never* public —
  the whole of it sits behind Cloudflare Access with an **"allowed emails"
  allowlist policy**, plus **WARP** access for onboarded/rolled-out devices. The
  in-app account is therefore an **additional security layer + the audit /
  accountability identity**, not the world-facing registration gate.
- **Resolved variant: (1) Access as the registration gate.** Open in-app signup
  is acceptable because only allowlisted emails (or WARP-onboarded devices) ever
  reach `/api/auth/sign-up`. This reconciles "open signup" with the access-
  control posture — at the cost of making Cloudflare Access **load-bearing for
  the registration path** (so Access is NOT optional for this deployment, even
  though PRD frames external layers as generically optional).

## Cross-System Convention

Self-hosted small-group tools normally provision a known set of users; the
deployment here implements that provisioning at the **network layer** (Access
email allowlist + WARP) rather than in-app. Open in-app signup is conventional
and safe *only* when fronted by such a gate — which is exactly this deployment's
design.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: stand up Better Auth email+password
> register/login/session with a global app-layer guard so that *every
> operational endpoint requires a valid session (401 otherwise)* — while open
> self-service signup is intentionally retained, **safe by virtue of Cloudflare
> Access (allowed-emails policy + WARP) fronting the entire app as the
> registration gate**. The in-app session is the audit identity and a second
> security layer, not the world-facing signup barrier.

The initial framing (**open signup**) **held up** — but with one load-bearing
qualification the original framing left implicit: open signup is only safe
because Access gates the whole app, so that dependency must be an explicit,
documented assumption rather than an accident of deployment. Nothing forces a
controlled-provisioning rewrite; D2 confirmed controlling signup would have been
role-free and cheap, but the user's deployment already closes the exposure at
the network layer.

## Confidence

**HIGH** — D3 strong + matches convention + decisive user-supplied deployment
context resolves the only open tension. The original open-signup framing is
confirmed valid *given* the Access-fronted deployment; the single residual item
is a documentation/assumption, not an unresolved design question.

## What Changes for /10x-plan

The plan is what `research.md` already maps (Better Auth + Drizzle adapter on
the shared connection, boot-time migration, global `APP_GUARD` + `@Public()`
allowlist for `/api/auth/*` and `/api/health`, Angular client/guard/401-
interceptor) — **with open signup left enabled**. Two additions the frame
mandates: (1) record "Cloudflare Access (allowed-emails + WARP) fronts the entire
app and is the registration gate" as an explicit deployment assumption /
non-functional dependency, so no future change exposes the app without Access and
silently turns open signup into world-open registration; (2) keep `disableSignUp`
off but note it as the one-line lever if the deployment assumption ever changes.

## References

- Source files: `context/foundation/prd.md:28,62-63,119-121`,
  `context/foundation/infrastructure.md:46,69,115,232`,
  `context/deployment/deploy-plan.md:154`,
  `.claude/rules/better-auth.md:17-18`,
  `context/changes/account-auth-foundation/research.md:158-164` (Open Q2).
- Related research: `context/changes/account-auth-foundation/research.md`.
- Investigation tasks: #1 (registration policy), #2 (controlled provisioning vs
  flat model), #3 (identity boundary + reachability).
