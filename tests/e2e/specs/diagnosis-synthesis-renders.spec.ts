import type { DiagnosisSynthesis } from '@opspilot/shared';

import { expect, test } from '@playwright/test';

import { seedRunRecord } from '../helpers/seed-run-record';

// risk: test-plan.md #1 — the full UI→synthesis path must render the fixed 4-field
//   diagnosis result (status, summary, problems, suggestions). a regression in the
//   shared run-record contract, the /api/.../diagnose/runs mapping, or the synthesis
//   card template would silently drop fields the user relies on. this asserts the
//   saved-run render path end to end.
// seed: tests/e2e/specs/smoke.spec.ts (storageState auth + getByRole conventions)
//
// real boundaries: auth (session cookie), routing (deep-linked service-detail), the real
//   /api/.../diagnose/runs read, real db, the real zod boundary parse, and the rendered
//   angular synthesis card. the saved run itself is seeded at the db because no api
//   endpoint creates one (the live stream needs real ssh+llm). nothing in the render
//   path is mocked.

test.describe('the saved diagnosis synthesis renders all four fields (risk #1)', () => {
  // the device created for this run; deleted in afterEach (cascade removes the service + run).
  let createdDeviceId: string | undefined;

  test.afterEach(async ({ request }) => {
    if (createdDeviceId) {
      await request.delete(`/api/devices/${createdDeviceId}`);
      createdDeviceId = undefined;
    }
  });

  test('service-detail renders the seeded run status, summary, problems and suggestions', async ({ page }) => {
    // unique suffix so the asserted strings can't collide with any other run/page state
    const stamp = Date.now();
    const synthesis: DiagnosisSynthesis = {
      problems: [`disk usage critical ${stamp}`],
      status: 'down',
      suggestions: [`restart the container ${stamp}`],
      summary: `service is unreachable ${stamp}`,
    };

    // create the device + service the run hangs off (no ssh/docker check on create)
    const deviceResponse = await page.request.post('/api/devices', {
      data: { host: `10.0.0.${stamp % 255}`, name: `e2e-device-${stamp}` },
    });
    expect(deviceResponse.ok(), await deviceResponse.text()).toBeTruthy();
    const device = await deviceResponse.json();
    createdDeviceId = device.id;

    const serviceResponse = await page.request.post(`/api/devices/${device.id}/services`, {
      data: { containerName: `e2e-svc-${stamp}`, deviceId: device.id, name: `e2e-service-${stamp}` },
    });
    expect(serviceResponse.ok(), await serviceResponse.text()).toBeTruthy();
    const service = await serviceResponse.json();

    // seed a completed run at the db — the only way to get a saved synthesis without a
    // live ssh+llm stream
    seedRunRecord({ deviceId: device.id, serviceId: service.id, synthesis });

    // open the page; on entry loadRuns() fetches the saved run and seeds the result card
    await page.goto(`/devices/${device.id}/services/${service.id}`);
    await expect(page.getByRole('heading', { name: `e2e-service-${stamp}` })).toBeVisible();

    // all four synthesis fields must reach the screen. problems and suggestions render only
    // in the synthesis card, so they pin the card specifically; status and summary derive
    // from the same saved run, so .first() is enough to prove the field rendered.
    await expect(page.getByText(`service is unreachable ${stamp}`).first()).toBeVisible();
    await expect(page.getByText(`disk usage critical ${stamp}`)).toBeVisible();
    await expect(page.getByText(`restart the container ${stamp}`)).toBeVisible();
    await expect(page.getByText('down').first()).toBeVisible();
  });
});
