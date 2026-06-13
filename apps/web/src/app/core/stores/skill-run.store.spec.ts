import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { type SkillRunResult } from '@opspilot/shared';

import { SkillRunClient } from '../clients/skill-run.client';
import { SkillRunStore } from './skill-run.store';

const deviceId = '00000000-0000-0000-0000-000000000001';
const serviceA = '00000000-0000-0000-0000-0000000000aa';
const serviceB = '00000000-0000-0000-0000-0000000000bb';
const skillStart = '00000000-0000-0000-0000-0000000000c1';
const skillStop = '00000000-0000-0000-0000-0000000000c2';

function makeClient() {
  const run = vi.fn();
  return { client: { run } as unknown as SkillRunClient, run };
}

function setup(client: SkillRunClient): SkillRunStore {
  TestBed.configureTestingModule({
    providers: [{ provide: SkillRunClient, useValue: client }, SkillRunStore],
  });
  return TestBed.inject(SkillRunStore);
}

const succeeded: SkillRunResult = { message: 'started', status: 'succeeded' };

describe('SkillRunStore', () => {
  it('returns an empty entry for a row with no run yet', () => {
    const { client } = makeClient();
    const store = setup(client);

    expect(store.entry(serviceA)).toEqual({ error: null, pending: null, result: null });
  });

  it('flips pending to the skillId while running, then patches the result and clears pending', async () => {
    const m = makeClient();
    let resolve!: (r: SkillRunResult) => void;
    m.run.mockReturnValueOnce(new Promise<SkillRunResult>((r) => (resolve = r)));
    const store = setup(m.client);

    const promise = store.run(deviceId, serviceA, skillStart, { inputs: {} });
    // mid-flight: pending holds the skillId, no result yet.
    expect(store.entry(serviceA)).toEqual({ error: null, pending: skillStart, result: null });

    resolve(succeeded);
    const result = await promise;

    expect(m.run).toHaveBeenCalledWith(deviceId, serviceA, skillStart, { inputs: {} });
    expect(result).toEqual({ error: null });
    expect(store.entry(serviceA)).toEqual({ error: null, pending: null, result: succeeded });
  });

  it('surfaces the api error message, returns it, and clears pending on a failed request', async () => {
    const m = makeClient();
    m.run.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { message: 'docker daemon is not running', status: 503, timestamp: '2026-06-11T00:00:00.000Z' },
      })
    );
    const store = setup(m.client);

    const result = await store.run(deviceId, serviceA, skillStart, { inputs: {} });

    expect(result).toEqual({ error: 'docker daemon is not running' });
    expect(store.entry(serviceA)).toEqual({
      error: 'docker daemon is not running',
      pending: null,
      result: null,
    });
  });

  it('falls back to a generic line for a transport-level failure', async () => {
    const m = makeClient();
    m.run.mockRejectedValueOnce(new Error('network down'));
    const store = setup(m.client);

    const result = await store.run(deviceId, serviceA, skillStop, { inputs: {} });

    expect(result).toEqual({ error: 'could not run skill' });
    expect(store.entry(serviceA)).toEqual({ error: 'could not run skill', pending: null, result: null });
  });

  it('keeps each row isolated — one row’s run does not clobber another', async () => {
    const m = makeClient();
    const resultB: SkillRunResult = { message: 'stopped', status: 'succeeded' };
    m.run.mockResolvedValueOnce(succeeded).mockResolvedValueOnce(resultB);
    const store = setup(m.client);

    await store.run(deviceId, serviceA, skillStart, { inputs: {} });
    await store.run(deviceId, serviceB, skillStop, { inputs: {} });

    expect(store.entry(serviceA).result).toEqual(succeeded);
    expect(store.entry(serviceB).result).toEqual(resultB);
  });
});
