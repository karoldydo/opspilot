import { expect, test } from '@playwright/test';

// risk: test-plan.md #1 — diagnoseLogs must never hang or crash; "no result at all"
//   must surface to the user as a clean, recoverable error. this exercises the
//   no-active-llm-provider facet: narrate() rejects in pre-flight (409) before the
//   stream opens, the native EventSource fires onerror, and the store renders a
//   surfaced error while clearing the loading state (no infinite spinner).
// seed: tests/e2e/specs/smoke.spec.ts (storageState auth + getByRole conventions)
//
// real boundaries: auth (session cookie), routing (deep-linked service-detail), the
//   real /api device+service create + the real /api/.../diagnose/stream pre-flight,
//   real db. the only thing absent is an active llm provider — which is exactly the
//   failure the user must survive. nothing is mocked.

test.describe('diagnose surfaces a clean error and never hangs (risk #1)', () => {
  // the device created for this run; deleted in afterEach (cascade removes the service).
  let createdDeviceId: string | undefined;

  test.afterEach(async ({ request }) => {
    if (createdDeviceId) {
      await request.delete(`/api/devices/${createdDeviceId}`);
      createdDeviceId = undefined;
    }
  });

  test('a diagnose run with no llm provider shows an error and re-enables the button', async ({ page }) => {
    // unique suffix so parallel runs / re-runs never collide on identity
    const stamp = Date.now();

    // create a device (no ssh connection test on create) over the authenticated api
    const deviceResponse = await page.request.post('/api/devices', {
      data: { host: `10.0.0.${stamp % 255}`, name: `e2e-device-${stamp}` },
    });
    expect(deviceResponse.ok(), await deviceResponse.text()).toBeTruthy();
    const device = await deviceResponse.json();
    createdDeviceId = device.id;

    // create a managed service on it (no docker check on create)
    const serviceResponse = await page.request.post(`/api/devices/${device.id}/services`, {
      data: { containerName: `e2e-svc-${stamp}`, deviceId: device.id, name: `e2e-service-${stamp}` },
    });
    expect(serviceResponse.ok(), await serviceResponse.text()).toBeTruthy();
    const service = await serviceResponse.json();

    // open the service-detail page; the service name heading is the stable anchor
    await page.goto(`/devices/${device.id}/services/${service.id}`);
    await expect(page.getByRole('heading', { name: `e2e-service-${stamp}` })).toBeVisible();

    // trigger a live diagnosis — with no active llm provider the stream 409s in pre-flight
    await page.getByRole('button', { name: 're-run' }).click();

    // the risk materializing would be a hang (spinner forever) or a crash; instead the
    // store must surface a clean, human-readable error
    await expect(page.getByRole('alert')).toHaveText('could not diagnose service');

    // and the run must terminate: loading clears, so the re-run button is enabled again
    // (no infinite "diagnosing…" spinner). this is the "never hangs" half of the risk.
    await expect(page.getByRole('button', { name: 're-run' })).toBeEnabled();
  });
});
