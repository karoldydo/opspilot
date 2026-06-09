# Manage Devices (FR-002 + FR-013) — Plan Brief

> Full plan: `context/changes/manage-devices/plan.md`
> Frame brief: `context/changes/manage-devices/frame.md`
> Research: `context/changes/manage-devices/research.md`

## What & Why

Build a **shared** device inventory CRUD (add / edit / delete) with SSH credentials encrypted
at-rest, managed as a separate sub-resource — FR-002 backed by FR-013. The motivation: this is
the app's first real domain feature and HTTP surface, wiring the already-shipped crypto /
credential / auth-guard infrastructure into a usable end-to-end slice.

## Starting Point

Both Drizzle tables (`device`, `credential`), `CryptoService` (AES-256-GCM), `CredentialService`
(encrypt-on-create, service-only decrypt, secret-omitting projection), `ZodValidationPipe`, and
the global `AuthAppGuard` already exist and are wired — but no domain controller, no device
contracts, no credential HTTP surface, no exception filter, and no devices UI exist yet. The
feature is mostly assembly.

## Desired End State

A logged-in user sees a shared list of all devices, adds one by entering name + host + SSH
credentials in a single form step, edits name/host, replaces credentials, and deletes a device
(cascading its credential). SSH secrets are stored encrypted and never leave `/api` in
plaintext. One global exception filter shapes every error.

## Key Decisions Made

| Decision                  | Choice                                    | Why (1 sentence)                                                      | Source   |
|---------------------------|-------------------------------------------|-----------------------------------------------------------------------|----------|
| Ownership model           | Shared (no `userId`)                      | `prd.md:121` "no separation of permissions"; flat-trust homelab.      | Frame    |
| Credential capture (API)  | Separate `/devices/:id/credentials`       | Data model already requires `deviceId` on credential create.          | Frame    |
| Create flow               | One UI step, two API calls                | Clean resource boundaries; no combined device+credential contract.    | Plan     |
| Partial-failure on create | Rollback — web `DELETE`s the device       | No device is ever orphaned without credentials.                       | Plan     |
| Credential edit           | Delete + recreate (no `PATCH`)            | Keeps zero rotation/versioning logic; true rotation is S-02+.         | Plan     |
| authType UX               | In scope (password=1 line / key=textarea) | Contract already carries `authType`; purely additive front-end.       | Frame    |
| Global exception filter   | Established here                          | First error-producing controller; `nestjs.md` mandates one.           | Frame    |
| Credential rotation       | Cut                                       | Belongs to the node-ssh executor slice (S-02+).                       | Frame    |
| Read `session.user.id`    | Not here                                  | Shared model needs no per-user filter; audit log isn't in this slice. | Plan     |
| FR-003 LAN scan           | Out of scope                              | Zero groundwork; parked post-MVP.                                     | Research |

## Scope

**In scope:** shared device CRUD; credential sub-resource (create/list/delete); two-call
create-with-rollback; authType conditional form; global exception filter; credential-list limit
clamp (impl-review F2); devices UI (list, add/edit dialog, delete confirm).

**Out of scope:** per-user ownership / `userId` migration; credential rotation / in-place
re-encrypt; reading `session.user.id`; FR-003 LAN discovery; node-ssh / connection testing; any
decrypt HTTP surface.

## Architecture / Approach

Bottom-up vertical slice: **shared Zod contracts** → **API** (`DeviceService` → controllers →
module wiring → global exception filter) → **web** (`DevicesStore` → list → add/edit dialog →
delete confirm). Create is one UI step backed by two API calls (`POST /devices` then
`POST /devices/:id/credentials`); on credential failure the web orchestrator issues
`DELETE /devices/:id` to roll back. Reuses `CredentialService` for all crypto — no new crypto,
table, or migration.

## Phases at a Glance

| Phase                                    | What it delivers                                          | Key risk                                                |
|------------------------------------------|-----------------------------------------------------------|---------------------------------------------------------|
| 1. Shared contracts                      | device schemas + bounded list-query, barrel exports       | Secret-containment split / `isoTimestamp` reuse wrong   |
| 2. API + sub-resource + exception filter | `DeviceModule`, credential HTTP surface, global filter    | `@Inject` DI gotcha; filter must match `apiErrorSchema` |
| 3. Web — store + UI                      | devices list, add/edit dialog, two-call create + rollback | Rollback orchestration; conditional authType control    |

**Prerequisites:** none beyond the shipped `encrypted-credential-store` infra; Phase 3 needs
`npx nx generate @spartan-ng/cli:ui --name=table,dialog,alert-dialog,select` (peer `@angular/cdk`).
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- Assumes the shared ownership model is final — if reversed to per-user, a `userId` FK migration
  + per-query filtering re-enter scope (frame confidence MEDIUM-HIGH, user-confirmed).
- The credential controller takes `deviceId` from the path as source of truth while the existing
  `credentialCreateRequestSchema` requires it in the body — reconcile (assert match) in Phase 2.
- Best-effort rollback `DELETE` could theoretically also fail; acceptable at homelab single-writer scale.

## Success Criteria (Summary)

- A user adds, edits, and deletes shared devices end-to-end through the UI.
- SSH credentials are stored encrypted and never appear in any `/api` response.
- `npm run build`, `npm run lint`, `npm run test` all pass; `npm run db:generate` emits no new migration.
