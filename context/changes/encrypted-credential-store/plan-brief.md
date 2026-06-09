# Encrypted Credential Store — Plan Brief

> Full plan: `context/changes/encrypted-credential-store/plan.md`
> Research: `context/changes/encrypted-credential-store/research.md`

## What & Why

Implement the crypto + storage layer that lets OpsPilot store SSH credentials **encrypted at-rest**
(PRD FR-013). A master AES-256 key comes from an env/secret var; secrets are encrypted with
AES-256-GCM (`node:crypto`, zero new deps) on write and decrypted on read inside the API service.
This protects against leak of a backup / DB file — the accepted threat model (self-host behind
Cloudflare Access, not host takeover).

## Starting Point

The foundation exists (config layer, boot-time migration runner + backup gate, empty schema barrel,
auth tables) but **no crypto code, no `device` entity, and no credential storage** — pure greenfield,
zero refactor risk. This is the F-03 work explicitly deferred by the data-persistence scaffold.

## Desired End State

The API refuses to boot without a valid master key. A `CryptoService` encrypts/decrypts with a random
per-record IV and GCM auth tag. A `credential` table (referencing a thin `device` table) stores only
ciphertext + IV + auth tag + `keyVersion`; a `CredentialService` writes (encrypting) and reads
(decrypting), returning a shared Zod contract that carries **no** secret material. Verification is via
automated tests — no HTTP endpoint ships in this change.

## Key Decisions Made

| Decision                    | Choice                                   | Why (1 sentence)                                                             | Source   |
|-----------------------------|------------------------------------------|------------------------------------------------------------------------------|----------|
| Master key location         | Env/secret var, AES-256-GCM              | Consistent with config layer; realistic for the accepted threat model        | Research |
| Crypto dependency           | Built-in `node:crypto` (Node 24)         | Zero new deps; `aes-256-gcm` available at runtime                            | Research |
| Key derivation              | Raw 32-byte key (no per-record KDF)      | Simplest; random per-record IV already gives semantic security               | Plan     |
| `device` FK boundary        | Thin `device` table as FK target only    | Real `.references(...)` cascade now; FR-002 CRUD builds on it without rework | Plan     |
| Shipped surface             | Service + tests only (no HTTP)           | Matches research scope; avoids premature wire contract before device exists  | Plan     |
| Key rotation forward-compat | Add `keyVersion` column (default 1)      | Cheap now; future rotation needs no schema migration                         | Plan     |
| Encrypted blob layout       | Separate `ciphertext`/`iv`/`authTag`     | Explicit, self-documenting, easy to validate                                 | Plan     |
| Secret safety               | `z.strictObject` + projection-not-spread | Secrets live only on the table; a leak becomes a compile/runtime error       | Research |

## Scope

**In scope:** `ENCRYPTION_KEY` env var + `crypto` config namespace; `CryptoService` (AES-256-GCM);
thin `device` table + `credential` table + migration `0001_*`; shared read + create-request contracts;
`CredentialService` (encrypt-on-write / decrypt-on-read, first typed Drizzle usage); unit/integration
tests.

**Out of scope:** `device` CRUD, HTTP controllers/endpoints/guards, node-ssh `IExecutor` integration,
key rotation flow, per-record KDF.

## Architecture / Approach

Bottom-up, four phases each with an independent gate: env key (boot guard) → crypto primitive (unit
tested in isolation) → schema + migration (applied at boot) → service joining crypto + storage and
mapping rows to a secret-safe contract. Secret material (ciphertext, IV, auth tag, plaintext, key
version) lives only on the Drizzle table; the shared `z.strictObject` contract omits it and the
service projects safe fields rather than spreading the row.

## Phases at a Glance

| Phase                         | What it delivers                                        | Key risk                                               |
|-------------------------------|---------------------------------------------------------|--------------------------------------------------------|
| 1. Config & master key        | `ENCRYPTION_KEY` fail-fast + `crypto` config namespace  | Joi validates encoded len, not decoded 32-byte length  |
| 2. Crypto module              | `CryptoService` AES-256-GCM (IV + auth tag) + tests     | Forgetting `setAuthTag` → tamper not detected          |
| 3. Schema & migration         | thin `device` + `credential` tables, migration `0001_*` | FK/index idiom drift; never `drizzle-kit migrate` live |
| 4. Shared contracts + service | secret-safe contracts + `CredentialService` round-trip  | Secret leaking into shared via spread / `$inferSelect` |

**Prerequisites:** a 44-char base64 (32-byte) `ENCRYPTION_KEY` in the API env; current foundation on
`main`.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- `CryptoService` must assert the decoded key is exactly 32 bytes — Joi `.length(44)` only checks the
  base64 string length, not decoded bytes.
- The thin `device` table's full shape (status, last-scan, etc.) is undesigned; later FR-002 work may
  add columns (additive migration, low risk).
- `keyVersion` is dead-but-present until a rotation change uses it.

## Success Criteria (Summary)

- API will not boot without a valid master key; a credential written to the DB shows only ciphertext.
- A round-trip (write→encrypt→store→read→decrypt) recovers the original secret.
- The returned `Credential` contract contains no ciphertext, IV, auth tag, plaintext, or key version.
