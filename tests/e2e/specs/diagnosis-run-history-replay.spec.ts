import type { DiagnosisSynthesis } from '@opspilot/shared';

import { expect, test } from '@playwright/test';

import { seedRunRecord } from '../helpers/seed-run-record';

// risk: test-plan.md #1 — with multiple saved runs the diagnose surface must be a static
//   history view, not a re-run. on entry it renders the newest saved run and one replay chip
//   per run; clicking an older chip swaps the result card to that run's synthesis WITHOUT
//   opening a live stream. a regression that made replay() re-stream (re-running ssh+llm) or
//   fail to swap the result would silently break this guarantee. this extends facet (b)
//   (single-run render) to the multi-run history + click-to-replay interaction.
// seed: tests/e2e/specs/diagnosis-synthesis-renders.spec.ts (storageState auth, db-seeded runs,
//   getByRole/getByText conventions)
//
// real boundaries: auth (session cookie), routing (deep-linked service-detail), the real
//   /api/.../diagnose/runs read, real db, the real zod boundary parse, and the rendered angular
//   run-history + synthesis card. the saved runs are seeded at the db because no api endpoint
//   creates one (the live stream needs real ssh+llm). nothing in the replay path is mocked.

test.describe('run-history replay swaps the result card without opening a stream (risk #1)', () => {
  // the device created for this run; deleted in afterEach (cascade removes the service + runs).
  let createdDeviceId: string | undefined;

  test.afterEach(async ({ request }) => {
    if (createdDeviceId) {
      await request.delete(`/api/devices/${createdDeviceId}`);
      createdDeviceId = undefined;
    }
  });

  test('clicking an older run chip swaps the synthesis and opens no live stream', async ({ page }) => {
    // unique suffix so the asserted strings can't collide with any other run/page state
    const stamp = Date.now();

    // two saved runs with distinct status/summary so each chip is uniquely locatable and the
    // card swap is observable. older = healthy (60s before), newer = down (now).
    const olderSynthesis: DiagnosisSynthesis = {
      problems: [`memory pressure ${stamp}`],
      status: 'healthy',
      suggestions: [`scale the pool ${stamp}`],
      summary: `older run was healthy ${stamp}`,
    };
    const newerSynthesis: DiagnosisSynthesis = {
      problems: [`container crash loop ${stamp}`],
      status: 'down',
      suggestions: [`restart the container ${stamp}`],
      summary: `newer run is down ${stamp}`,
    };

    // create the device + service the runs hang off (no ssh/docker check on create)
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

    // seed two completed runs at the db with distinct timestamps so /diagnose/runs orders them
    // newest-first (the api sorts by created_at desc; insert order is irrelevant).
    seedRunRecord({
      createdAtMs: stamp - 60_000,
      deviceId: device.id,
      serviceId: service.id,
      synthesis: olderSynthesis,
    });
    seedRunRecord({ createdAtMs: stamp, deviceId: device.id, serviceId: service.id, synthesis: newerSynthesis });

    // open the page; on entry loadRuns() seeds the result card from the newest saved run (no auto-stream)
    await page.goto(`/devices/${device.id}/services/${service.id}`);
    await expect(page.getByRole('heading', { name: `e2e-service-${stamp}` })).toBeVisible();

    // on entry: the newest run's summary owns the card; both replay chips are present (uniquely
    // located by their distinct status text); the panel header reads idle and re-run is enabled —
    // dom proof that no stream is live.
    await expect(page.getByText(`newer run is down ${stamp}`).first()).toBeVisible();
    const olderChip = page.getByRole('button', { name: /healthy/ });
    const newerChip = page.getByRole('button', { name: /down/ });
    await expect(olderChip).toBeVisible();
    await expect(newerChip).toBeVisible();
    await expect(page.getByText('agent run · idle')).toBeVisible();
    await expect(page.getByRole('button', { name: 're-run' })).toBeEnabled();

    // collect any live-stream request fired during the replay — replay must open none
    const streamRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/diagnose/stream')) {
        streamRequests.push(request.url());
      }
    });

    // click the older (healthy) chip — replay() is a pure state swap with stream teardown
    await olderChip.click();

    // the card swaps to the older run's synthesis; the newer summary leaves the screen entirely
    await expect(page.getByText(`older run was healthy ${stamp}`).first()).toBeVisible();
    await expect(page.getByText(`newer run is down ${stamp}`)).toHaveCount(0);

    // and no stream opened: the panel header stays idle, re-run stays enabled (dom proof), and
    // no request to /diagnose/stream fired (network proof) — replay is history, not a re-run.
    await expect(page.getByText('agent run · idle')).toBeVisible();
    await expect(page.getByRole('button', { name: 're-run' })).toBeEnabled();
    expect(streamRequests).toHaveLength(0);
  });
});
