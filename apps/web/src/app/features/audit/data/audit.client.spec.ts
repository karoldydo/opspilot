import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type AuditEvent } from '@opspilot/shared';

import { AuditClient } from './audit.client';

const event: AuditEvent = {
  action: 'device.create',
  createdAt: '2026-06-10T00:00:00.000Z',
  id: '11111111-1111-4111-8111-111111111111',
  metadata: { name: 'nas' },
  runRecordId: null,
  targetId: '22222222-2222-4222-8222-222222222222',
  targetType: 'device',
  userId: 'user-1',
};

describe('AuditClient', () => {
  let client: AuditClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AuditClient],
    });
    client = TestBed.inject(AuditClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('parses the timeline at the boundary', async () => {
    const promise = client.list();
    const request = httpMock.expectOne('/api/audit');
    expect(request.request.method).toBe('GET');
    request.flush([event]);

    const result = await promise;
    expect(result).toEqual([event]);
  });

  it('sends only the defined query params', async () => {
    const promise = client.list({ action: 'skill.run', limit: 25, offset: 0 });
    const request = httpMock.expectOne((req) => req.url === '/api/audit');
    expect(request.request.params.get('action')).toBe('skill.run');
    expect(request.request.params.get('limit')).toBe('25');
    expect(request.request.params.get('offset')).toBe('0');
    // an omitted filter is never sent as an empty string.
    expect(request.request.params.has('from')).toBe(false);
    request.flush([]);

    await promise;
  });

  it('rejects a row carrying a leaked unknown key', async () => {
    const promise = client.list();
    const request = httpMock.expectOne('/api/audit');
    // a leaked key must fail the strict parse at the boundary.
    request.flush([{ ...event, secret: 'leaked' }]);

    await expect(promise).rejects.toThrow();
  });
});
