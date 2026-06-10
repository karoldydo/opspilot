---
paths:
  - apps/api/**/*.ts
---
# Remote command execution (node-ssh + per-device concurrency)

Remote commands run over **node-ssh behind an executor abstraction**, with **async-mutex**
enforcing per-device isolation. This is in `apps/api` only - never in `@opspilot/shared` (it is
I/O; see `shared-library.md`).

## Executor abstraction

- Define an `IExecutor` interface (`connect`, `disconnect`, `execute`) and implement it with a
  node-ssh-backed executor injected as a provider. Skills depend on the interface, not on
  node-ssh directly - so the transport can be swapped or faked in tests.

## Per-device concurrency

- Serialize commands per device with async-mutex: keep a `Map<deviceId, Mutex>` and run each
  device's work through `mutex.runExclusive(...)`. Two skills targeting the same device never
  interleave; different devices run in parallel.

## Safety

- Give every command a timeout and dispose the connection after use - no run hangs indefinitely.
- Serialize only the per-device SSH path (the async-mutex above); leave genuinely independent
  work concurrent.

## Host keys (accepted risk)

- The executor connects **without** a `hostVerifier`/`hostHash`, so node-ssh trusts any host key
  on first contact. This is a deliberate homelab tradeoff: devices live on a trusted LAN, so TOFU
  key pinning is out of scope. If a device ever sits outside the LAN, revisit this and add a
  `hostVerifier` backed by a stored/pinned key before connecting.
