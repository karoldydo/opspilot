# Scan and Add Services (S-02) — Plan Brief

> Full plan: `context/changes/scan-and-add-services/plan.md`
> Research: `context/changes/scan-and-add-services/research.md`

## What & Why

S-02 is the product's **first SSH-out operation**: a user scans the docker containers on a device
over SSH and curates a managed-services subset (add selected, edit display name, delete). It builds
the **reusable SSH executor** that every later skill (S-04 diagnose, S-06 restart, S-08 skills)
inherits, and establishes the scan-vs-managed split that limits the agent's reach (PRD FR-004,
FR-007).

## Starting Point

The `device`/`credential` slice (S-01) is done and is the verbatim template — but **nothing
SSH-related exists yet**: no `node-ssh`, no executor, no connect code. `CredentialService.
getDecryptedSecret()` was built and never called; S-02 is its first caller. No `service` table or
contract exists anywhere.

## Desired End State

A logged-in user clicks **Scan** on a device row, sees every detected container (name, image, live
status) in a dialog, selects a subset, and persists it as managed services with edit-name and delete
actions. Unreachable hosts, docker-less hosts, stopped daemons, and hung commands each surface a
distinct, legible error instead of a hang or a generic failure.

## Key Decisions Made

| Decision              | Choice                                           | Why (1 sentence)                                                              | Source   |
|-----------------------|--------------------------------------------------|-------------------------------------------------------------------------------|----------|
| `scanServices` shape  | Private backend method (no skill record)         | Skill-as-data is S-08 (~6 slices off); "hidden built-in" means hardcoded.     | Research |
| Service identity      | `unique(deviceId, containerName)`                | Container ids change on recreate; name is stable; guard blocks duplicates.    | Plan     |
| Endpoint shape        | Nested under `/devices/:id` (scan + services)    | Mirrors the credential sub-resource; path param = source of truth, 404 cross. | Research |
| SSH timeouts          | connect 10s / command 30s (config, Joi-bounded)  | Separate connect timeout fails fast on dead hosts; 30s fits `docker ps`.      | Plan     |
| Error taxonomy        | 4 distinct classes                               | connect / auth / timeout (executor) + docker-not-found / daemon-down (svc).   | Research |
| Curation UX           | Multi-select dialog of detected containers       | Reuses the spartan dialog + `device-form.dialog` context pattern.             | Plan     |
| Service edit scope    | Display `name` only                              | Identity fields are scan-derived; re-target = delete + re-scan.               | Plan     |
| Re-scan / concurrency | Per-device mutex, fresh scan, no drift detection | Keeps the slice narrow; drift is a later health skill's job; homelab scale.   | Plan     |

## Scope

**In scope:** SSH executor (node-ssh + async-mutex + timeout + dispose + decrypt-error wrapping +
connect/auth/timeout taxonomy); `service` table + migration; scan endpoint (docker ps → NDJSON);
service CRUD nested under the device; Angular scan-and-curate dialog + managed-services list.

**Out of scope:** skill-as-data model (S-08); AI-SDK / tool-calling (S-04); drift detection;
instance-wide concurrent-scan cap; editing identity fields; persisting runtime facts;
connection-test-on-add.

## Architecture / Approach

Bottom-up, 4 phases: **shared contracts** (consumed by both executor parsing and the domain) →
**executor** (cross-cutting provider module exporting `IExecutor` via a DI token, generic SSH only) →
**service domain backend** (table + `scan` via executor + CRUD nested under `/devices/:id`; the
docker-specific error interpretation lives here) → **web feature** (client + store + dialog + list).
The error taxonomy splits cleanly: connect/auth/timeout are executor-level domain errors;
docker-not-found/daemon-down are `ServiceService` interpretations of exit code + stderr.

## Phases at a Glance

| Phase                       | What it delivers                                              | Key risk                                                        |
|-----------------------------|---------------------------------------------------------------|-----------------------------------------------------------------|
| 1. Shared Contracts         | 4 Zod schemas (service, create, update, scan-result) + barrel | Getting the scanned-container shape right vs real docker output |
| 2. SSH Executor             | `IExecutor` + `SshExecutor` (mutex, timeout, dispose, errors) | Hand-rolled command timeout + unconditional dispose correctness |
| 3. Service Domain (backend) | Table + migration + scan + CRUD nested under device           | NDJSON parse + docker-error interpretation; unique-guard NULLs  |
| 4. Web Feature              | Client + store + scan-curate dialog + managed list            | Batch-add partial-failure UX; component size threshold          |

**Prerequisites:** S-01 (manage-devices) done ✓. A reachable test device with docker for manual
verification.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- The exact node-ssh auth wiring (password vs `privateKey`) and which credential to pick when a
  device has several — resolved during Phase 2 implementation (pick the device's credential by
  `authType`).
- `DeviceService` is not currently exported from `DeviceModule`; the executor needs `device.host`,
  so either export it or inject the DB + `device` table directly (Phase 2 decision, noted in plan).
- Mapping the docker-not-found vs daemon-down stderr strings is host-dependent; verify against the
  real Synology target (`.claude/rules/ssh.md:8` PATH hint).

## Success Criteria (Summary)

- A user scans a real device, curates a subset, and manages (edit name / delete) the result end to
  end.
- Each of the four failure classes (connect, command timeout, docker-not-on-PATH, daemon-down)
  produces a distinct, legible error — no hang.
- The executor serializes per device and always disposes — the "no run hangs indefinitely" NFR holds.
