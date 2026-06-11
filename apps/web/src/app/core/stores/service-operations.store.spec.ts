import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { type ServiceOperationResult } from '@opspilot/shared';

import { ServiceOperationsClient } from '../clients/service-operations.client';
import { ServiceOperationsStore } from './service-operations.store';

const deviceId = '00000000-0000-0000-0000-000000000001';
const serviceA = '00000000-0000-0000-0000-0000000000aa';
const serviceB = '00000000-0000-0000-0000-0000000000bb';

function makeClient() {
  const run = vi.fn();
  return { client: { run } as unknown as ServiceOperationsClient, run };
}

function setup(client: ServiceOperationsClient): ServiceOperationsStore {
  TestBed.configureTestingModule({
    providers: [{ provide: ServiceOperationsClient, useValue: client }, ServiceOperationsStore],
  });
  return TestBed.inject(ServiceOperationsStore);
}

const succeeded: ServiceOperationResult = { message: 'started', operation: 'start', status: 'succeeded' };

describe('ServiceOperationsStore', () => {
  it('returns an empty entry for a row with no op run yet', () => {
    const { client } = makeClient();
    const store = setup(client);

    expect(store.entry(serviceA)).toEqual({ error: null, pending: null, result: null });
  });

  it('flips pending while the op runs, then patches the result and clears pending', async () => {
    const m = makeClient();
    let resolve!: (r: ServiceOperationResult) => void;
    m.run.mockReturnValueOnce(new Promise<ServiceOperationResult>((r) => (resolve = r)));
    const store = setup(m.client);

    const promise = store.run(deviceId, serviceA, 'start');
    // mid-flight: pending is set, no result yet.
    expect(store.entry(serviceA)).toEqual({ error: null, pending: 'start', result: null });

    resolve(succeeded);
    await promise;

    expect(m.run).toHaveBeenCalledWith(deviceId, serviceA, 'start');
    expect(store.entry(serviceA)).toEqual({ error: null, pending: null, result: succeeded });
  });

  it('surfaces the api error message and clears pending on a failed request', async () => {
    const m = makeClient();
    m.run.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { message: 'docker daemon is not running', status: 503, timestamp: '2026-06-11T00:00:00.000Z' },
      })
    );
    const store = setup(m.client);

    await store.run(deviceId, serviceA, 'restart');

    expect(store.entry(serviceA)).toEqual({ error: 'docker daemon is not running', pending: null, result: null });
  });

  it('falls back to a generic line for a transport-level failure', async () => {
    const m = makeClient();
    m.run.mockRejectedValueOnce(new Error('network down'));
    const store = setup(m.client);

    await store.run(deviceId, serviceA, 'stop');

    expect(store.entry(serviceA)).toEqual({ error: 'could not run operation', pending: null, result: null });
  });

  it('keeps each row isolated — one row’s op does not clobber another', async () => {
    const m = makeClient();
    const resultB: ServiceOperationResult = { message: 'stopped', operation: 'stop', status: 'succeeded' };
    m.run.mockResolvedValueOnce(succeeded).mockResolvedValueOnce(resultB);
    const store = setup(m.client);

    await store.run(deviceId, serviceA, 'start');
    await store.run(deviceId, serviceB, 'stop');

    expect(store.entry(serviceA).result).toEqual(succeeded);
    expect(store.entry(serviceB).result).toEqual(resultB);
  });
});
