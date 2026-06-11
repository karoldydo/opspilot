import { TestBed } from '@angular/core/testing';
import { type RunNarrationEvent, type RunRecord } from '@opspilot/shared';

import { DiagnosisClient, type DiagnosisStreamHandlers } from '../clients/diagnosis.client';
import { DiagnosisStore } from './diagnosis.store';

const deviceId = '00000000-0000-0000-0000-000000000001';
const serviceA = '00000000-0000-0000-0000-0000000000aa';
const serviceB = '00000000-0000-0000-0000-0000000000bb';

// a fake client that captures the per-service stream handlers so a test can drive
// frames, plus a close spy per open stream. recentRuns is a plain spy.
function makeClient() {
  const handlers = new Map<string, DiagnosisStreamHandlers>();
  const closes = new Map<string, ReturnType<typeof vi.fn>>();
  const recentRuns = vi.fn().mockResolvedValue([]);
  const stream = vi.fn((_d: string, serviceId: string, h: DiagnosisStreamHandlers) => {
    handlers.set(serviceId, h);
    const close = vi.fn();
    closes.set(serviceId, close);
    return close;
  });
  return {
    client: { recentRuns, stream } as unknown as DiagnosisClient,
    closeFor: (serviceId: string) => closes.get(serviceId),
    emit: (serviceId: string, event: RunNarrationEvent) => handlers.get(serviceId)?.event(event),
    recentRuns,
    stream,
    transportError: (serviceId: string) => handlers.get(serviceId)?.transportError(),
  };
}

function makeRun(id: string, serviceId: string, status: RunRecord['synthesis']['status']): RunRecord {
  return {
    createdAt: '2026-06-11T00:00:00.000Z',
    deviceId,
    id,
    serviceId,
    synthesis: { problems: [], status, suggestions: [], summary: `run ${id}` },
  };
}

function setup(client: DiagnosisClient): DiagnosisStore {
  TestBed.configureTestingModule({
    providers: [{ provide: DiagnosisClient, useValue: client }, DiagnosisStore],
  });
  return TestBed.inject(DiagnosisStore);
}

describe('DiagnosisStore', () => {
  it('returns an empty entry for an un-diagnosed row', () => {
    const { client } = makeClient();
    const store = setup(client);

    expect(store.entry(serviceA)).toEqual({ error: null, loading: false, partial: null, result: null, runs: [] });
  });

  it('flips loading on when a stream opens', () => {
    const m = makeClient();
    const store = setup(m.client);

    store.stream(deviceId, serviceA);

    expect(m.stream).toHaveBeenCalledWith(deviceId, serviceA, expect.anything());
    expect(store.entry(serviceA)).toMatchObject({ error: null, loading: true, partial: null, result: null });
  });

  it('merges each delta into the in-progress partial', () => {
    const m = makeClient();
    const store = setup(m.client);

    store.stream(deviceId, serviceA);
    m.emit(serviceA, { partial: { summary: 'looking…' }, type: 'delta' });
    m.emit(serviceA, { partial: { status: 'degraded' }, type: 'delta' });

    expect(store.entry(serviceA).partial).toEqual({ status: 'degraded', summary: 'looking…' });
    expect(store.entry(serviceA).result).toBeNull();
  });

  it('on done sets the result, clears the partial, prepends the run, and closes the source', () => {
    const m = makeClient();
    const store = setup(m.client);
    const run = makeRun('r1', serviceA, 'healthy');

    store.stream(deviceId, serviceA);
    m.emit(serviceA, { partial: { summary: 'looking…' }, type: 'delta' });
    m.emit(serviceA, { run, type: 'done' });

    expect(store.entry(serviceA)).toMatchObject({
      error: null,
      loading: false,
      partial: null,
      result: run.synthesis,
      runs: [run],
    });
    expect(m.closeFor(serviceA)).toHaveBeenCalled();
  });

  it('on an error frame surfaces the message and closes the source', () => {
    const m = makeClient();
    const store = setup(m.client);

    store.stream(deviceId, serviceA);
    m.emit(serviceA, { code: 'synthesis-failed', message: 'the model produced no object', type: 'error' });

    expect(store.entry(serviceA)).toMatchObject({
      error: 'the model produced no object',
      loading: false,
      partial: null,
      result: null,
    });
    expect(m.closeFor(serviceA)).toHaveBeenCalled();
  });

  it('renders a generic line on a transport error while streaming', () => {
    const m = makeClient();
    const store = setup(m.client);

    store.stream(deviceId, serviceA);
    m.transportError(serviceA);

    expect(store.entry(serviceA)).toMatchObject({ error: 'could not diagnose service', loading: false });
  });

  it('ignores a transport error fired after the stream already completed', () => {
    const m = makeClient();
    const store = setup(m.client);
    const run = makeRun('r1', serviceA, 'healthy');

    store.stream(deviceId, serviceA);
    m.emit(serviceA, { run, type: 'done' });
    m.transportError(serviceA);

    // the done result stands; the late transport error does not overwrite it.
    expect(store.entry(serviceA).result).toEqual(run.synthesis);
    expect(store.entry(serviceA).error).toBeNull();
  });

  it('replays a saved run statically into the result', () => {
    const m = makeClient();
    const store = setup(m.client);
    const run = makeRun('old', serviceA, 'down');

    store.replay(serviceA, run);

    expect(store.entry(serviceA)).toMatchObject({ error: null, loading: false, partial: null, result: run.synthesis });
  });

  it('loads recent runs into the row', async () => {
    const m = makeClient();
    const runs = [makeRun('r2', serviceA, 'healthy'), makeRun('r1', serviceA, 'degraded')];
    m.recentRuns.mockResolvedValueOnce(runs);
    const store = setup(m.client);

    await store.loadRuns(deviceId, serviceA);

    expect(m.recentRuns).toHaveBeenCalledWith(deviceId, serviceA);
    expect(store.entry(serviceA).runs).toEqual(runs);
  });

  it('keeps each row isolated — streaming one does not clobber another', () => {
    const m = makeClient();
    const store = setup(m.client);
    const runA = makeRun('a', serviceA, 'healthy');
    const runB = makeRun('b', serviceB, 'down');

    store.stream(deviceId, serviceA);
    store.stream(deviceId, serviceB);
    m.emit(serviceA, { run: runA, type: 'done' });
    m.emit(serviceB, { run: runB, type: 'done' });

    expect(store.entry(serviceA).result).toEqual(runA.synthesis);
    expect(store.entry(serviceB).result).toEqual(runB.synthesis);
  });
});
