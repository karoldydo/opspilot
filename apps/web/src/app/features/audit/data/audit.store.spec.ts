import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { AuditClient } from '@app/features/audit/data/audit.client';
import { type AuditEvent } from '@opspilot/shared';

import { AuditStore } from './audit.store';

const event: AuditEvent = {
  action: 'diagnose.run',
  createdAt: '2026-06-10T00:00:00.000Z',
  id: '11111111-1111-4111-8111-111111111111',
  metadata: null,
  runRecordId: '33333333-3333-4333-8333-333333333333',
  synthesis: { problems: ['disk full'], status: 'degraded', suggestions: ['free space'], summary: 'degraded' },
  targetId: '22222222-2222-4222-8222-222222222222',
  targetType: 'service',
  userId: 'user-1',
};

function apiError(message: string, status: number): HttpErrorResponse {
  return new HttpErrorResponse({ error: { message, status, timestamp: '2026-06-10T00:00:00.000Z' }, status });
}

function setup(client: Partial<AuditClient>): AuditStore {
  TestBed.configureTestingModule({
    providers: [{ provide: AuditClient, useValue: client }, AuditStore],
  });
  return TestBed.inject(AuditStore);
}

describe('AuditStore', () => {
  it('loads the timeline on success', async () => {
    const list = vi.fn().mockResolvedValue([event]);
    const store = setup({ list });

    await store.load();

    expect(list).toHaveBeenCalledOnce();
    expect(store.events()).toEqual([event]);
    expect(store.error()).toBeNull();
    expect(store.isEmpty()).toBe(false);
  });

  it('surfaces the error message and leaves the list empty on failure', async () => {
    const list = vi.fn().mockRejectedValue(apiError('could not load audit log', 500));
    const store = setup({ list });

    await store.load();

    expect(store.error()).toBe('could not load audit log');
    expect(store.events()).toEqual([]);
    expect(store.isEmpty()).toBe(true);
  });

  it('toggles the selected row: selecting opens, selecting again collapses', async () => {
    const list = vi.fn().mockResolvedValue([event]);
    const store = setup({ list });
    await store.load();

    store.select(event.id);
    expect(store.selectedId()).toBe(event.id);

    store.select(event.id);
    expect(store.selectedId()).toBeNull();
  });
});
