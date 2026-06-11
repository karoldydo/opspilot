import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { type DiagnosisSynthesis } from '@opspilot/shared';

import { DiagnosisClient } from '../clients/diagnosis.client';
import { DiagnosisStore } from './diagnosis.store';

const deviceId = '00000000-0000-0000-0000-000000000001';
const serviceA = '00000000-0000-0000-0000-0000000000aa';
const serviceB = '00000000-0000-0000-0000-0000000000bb';

const synthesisA: DiagnosisSynthesis = {
  problems: ['oom kills observed'],
  status: 'down',
  suggestions: ['raise the memory limit'],
  summary: 'the container is being oom-killed',
};

const synthesisB: DiagnosisSynthesis = {
  problems: [],
  status: 'healthy',
  suggestions: [],
  summary: 'all green',
};

function apiError(message: string, status: number): HttpErrorResponse {
  return new HttpErrorResponse({ error: { message, status, timestamp: '2026-06-11T00:00:00.000Z' }, status });
}

function setup(client: Partial<DiagnosisClient>): DiagnosisStore {
  TestBed.configureTestingModule({
    providers: [{ provide: DiagnosisClient, useValue: client }, DiagnosisStore],
  });
  return TestBed.inject(DiagnosisStore);
}

describe('DiagnosisStore', () => {
  it('returns an empty entry for an un-diagnosed row', () => {
    const store = setup({ diagnose: vi.fn() });

    expect(store.entry(serviceA)).toEqual({ error: null, loading: false, result: null });
  });

  it('diagnoses a row and stores the synthesis under its key', async () => {
    const diagnose = vi.fn().mockResolvedValue(synthesisA);
    const store = setup({ diagnose });

    const result = await store.diagnose(deviceId, serviceA);

    expect(result).toEqual({ error: null });
    expect(diagnose).toHaveBeenCalledWith(deviceId, serviceA);
    expect(store.entry(serviceA)).toEqual({ error: null, loading: false, result: synthesisA });
  });

  it('surfaces a synthesis failure as the row error message', async () => {
    const diagnose = vi
      .fn()
      .mockRejectedValue(apiError('active provider did not return schema-conformant output', 502));
    const store = setup({ diagnose });

    const result = await store.diagnose(deviceId, serviceA);

    expect(result).toEqual({ error: 'active provider did not return schema-conformant output' });
    expect(store.entry(serviceA)).toEqual({
      error: 'active provider did not return schema-conformant output',
      loading: false,
      result: null,
    });
  });

  it('keeps each row isolated — diagnosing one does not clobber another', async () => {
    const diagnose = vi.fn().mockResolvedValueOnce(synthesisA).mockResolvedValueOnce(synthesisB);
    const store = setup({ diagnose });

    await store.diagnose(deviceId, serviceA);
    await store.diagnose(deviceId, serviceB);

    expect(store.entry(serviceA).result).toEqual(synthesisA);
    expect(store.entry(serviceB).result).toEqual(synthesisB);
  });
});
