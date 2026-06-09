# Frame Brief: Manage devices (FR-002 + FR-013)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Implement `manage-devices` — FR-002 (manually add a device: address + SSH
credentials, edit, delete) backed by FR-013 (SSH credentials encrypted
at-rest) — as a full-stack vertical slice (NestJS api + Angular web + shared
Zod contracts), reusing the existing encrypted-credential-store infrastructure.

## Initial Framing (preserved)

- **User's stated cause or approach**: the change is "mostly assembly, not
  invention" — both tables, crypto, the config chain, the Zod pipe and the auth
  guard already exist; this slice wires them into the app's first real HTTP
  surface + UI.
- **User's proposed direction**: add `DeviceModule` (controller + service),
  device Zod contracts in `@opspilot/shared`, the first domain HTTP surface, the
  first reader of `request.session.user.id`, and the Angular devices UI.
- **Pre-dispatch narrowing** (Step 1.5 answers):
  - Ownership → **Per-user owned** (add `userId` FK, filter every query,
    NotFound on another user's id).
  - Credential capture → **Separate sub-resource** (`/api/devices/:id/credentials`).
  - Scope boundary → **all three** deferred items pulled in: authType UX +
    credential rotation + global exception filter.

## Dimension Map

The observation could diverge from the right problem at these dimensions:

1. **Ownership model** — per-user (chosen) vs shared (implied by the table). ← chosen framing under challenge
2. **Credential capture shape** — separate sub-resource (chosen) vs combined create.
3. **Scope boundary** — three deferred items in-scope; do any belong to a later slice?
4. **"Mostly assembly" claim** — already strongly evidenced in research (file:line); not re-investigated (guardrail #6).

## Hypothesis Investigation

| Hypothesis                                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                 | Verdict                      |
|-----------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------|
| Ownership should be **SHARED**, not per-user                    | `prd.md:121` "all logged-in users have the same permissions… accountability solely by the audit log, **not by separation of permissions**"; `prd.md:28` "trusted users (family/housemates)"; `roadmap.md:223-234` audit = who-did-what, not visibility limits; `device.schema.ts:4-15` has no `userId`. Per-user reading rests only on generic "a user can…" (`roadmap.md:129`), used for every feature. | **STRONG** (reframe)         |
| Credential capture should be **SEPARATE sub-resource** (chosen) | `credential-create-request.schema.ts:9` `deviceId` is **required**; `device.schema.ts:29-31` non-null FK + `onDelete:'cascade'`; F-03 plan `:77-80` deferred device CRUD as a separate concern. Data model already commits to device-before-credential.                                                                                                                                                  | **STRONG** (confirms choice) |
| authType key/password UX belongs in this slice                  | contract already carries `authType: z.enum(['password','key'])` (`credential-create-request.schema.ts:8`, `credential.schema.ts:13`); purely additive front-end.                                                                                                                                                                                                                                         | **IN-SCOPE**                 |
| Credential **rotation** belongs in this slice                   | deferred to node-ssh executor: `research.md:284-285`, impl-review F1 (`impl-review.md:51-52`), F-03 plan `:86` "no key rotation logic"; SSH-out is born in S-02 (`roadmap.md:148`).                                                                                                                                                                                                                      | **SCOPE-BLOAT → cut**        |
| Global exception filter belongs in this slice                   | `nestjs.md:54-56` mandates one app-wide; none exists; this is the first error-producing controller (`research.md:127,244`). Architectural call, not feature bloat.                                                                                                                                                                                                                                       | **IN-SCOPE (arch decision)** |

## Narrowing Signals

- `prd.md:121` is near-dispositive: "no separation of permissions." Per-user
  device ownership **is** a separation of permissions → directly in tension with
  the chosen per-user model. Inverse check: a per-user product would state a
  privacy guarantee here; it states the opposite.
- The credential contract's required `deviceId` (`credential-create-request.schema.ts:9`)
  already forces device-first ordering — the chosen sub-resource shape is the
  path of least resistance, not a new constraint.
- Rotation is consistently tied to "the first real caller" of credential
  decryption (the node-ssh `IExecutor`), which is an S-02+ concern — not S-01.

## Cross-System Convention

Flat-trust homelab tools scope shared operational inventory to "any logged-in
user" and rely on an audit trail for accountability — which is exactly the model
`prd.md:121` and `prd.md:28` describe. Per-user resource ownership is the SaaS
multi-tenant convention, which the PRD explicitly disclaims (no roles, no RBAC,
no permission separation).

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: a *shared* device inventory CRUD
> (no per-user ownership) with encrypted SSH credentials managed as a separate
> sub-resource, scoped to add/edit/delete + authType UX + a global exception
> filter — and **without** credential rotation.

Two of the three chosen positions hold up; two diverge from the evidence:

- **Ownership (reframe)**: the PRD's flat-trust model + audit-log accountability
  point to **shared** devices. The chosen per-user model adds a `userId` FK +
  migration + per-query filtering that contradicts `prd.md:121`. If devices are
  per-user the PRD would need to grant a privacy guarantee it currently denies.
- **Credential capture (confirmed)**: separate sub-resource is correct — the data
  model already commits to it. (Plan note: the *web UX* can still present a single
  "add device" step that issues two calls; the API split need not leak into the form.)
- **Rotation (cut)**: belongs to the node-ssh executor slice (S-02+), not here.
- **authType UX + exception filter (keep)**: both fit this slice.

## Confidence

- **MEDIUM-HIGH** — Ownership reframe has STRONG document evidence and survives
  the inverse check, but it overrides an explicit user choice, so it needs the
  user's confirmation before planning. Credential-shape and scope-boundary
  findings are HIGH (data model + roadmap sequencing decide them). Verification
  step before /10x-plan: **confirm shared-vs-per-user** — this single decision
  gates whether a `userId` migration + per-user filtering is in the plan at all.

## What Changes for /10x-plan

Plan a **shared** device CRUD (recommended — confirm first) with credentials as
a `/api/devices/:id/credentials` sub-resource, authType conditional form, and a
global exception filter established here; **drop credential rotation** from scope
(defer to the node-ssh executor slice). If the user holds per-user after seeing
`prd.md:121`, the plan additionally owns a `userId` FK migration + per-query
ownership filtering + NotFound-on-foreign-id.

## References

- Source: `context/foundation/prd.md:28,68-69,121`, `context/foundation/roadmap.md:127-137,148,223-234`
- Data model: `apps/api/src/database/schema/device.schema.ts:4-15,29-31`
- Contracts: `libs/shared/src/lib/schemas/credential-create-request.schema.ts:8-9`, `credential.schema.ts:13`
- Prior decisions: `context/archive/2026-06-09-encrypted-credential-store/` (plan `:77-80,86`; impl-review F1 `:51-52`)
- Research: `context/changes/manage-devices/research.md` (Open Questions 1–5)
- Investigation: 3 parallel Explore agents (ownership intent; credential-capture shape; scope-bloat vs roadmap sequencing)
