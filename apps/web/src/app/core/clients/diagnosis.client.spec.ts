import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type DiagnosisSynthesis } from '@opspilot/shared';

import { DiagnosisClient } from './diagnosis.client';

const deviceId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';

const synthesis: DiagnosisSynthesis = {
  problems: ['container restarted 3 times in the last hour'],
  status: 'degraded',
  suggestions: ['inspect the crash logs', 'raise the memory limit'],
  summary: 'the service is flapping under memory pressure',
};

describe('DiagnosisClient', () => {
  let client: DiagnosisClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), DiagnosisClient],
    });
    client = TestBed.inject(DiagnosisClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('posts to the diagnose path and parses the synthesis at the boundary', async () => {
    const promise = client.diagnose(deviceId, serviceId);
    const request = httpMock.expectOne(`/api/devices/${deviceId}/services/${serviceId}/diagnose`);
    expect(request.request.method).toBe('POST');
    request.flush(synthesis);

    const result = await promise;
    expect(result).toEqual(synthesis);
  });

  it('rejects a synthesis response carrying an unknown key', async () => {
    const promise = client.diagnose(deviceId, serviceId);
    const request = httpMock.expectOne(`/api/devices/${deviceId}/services/${serviceId}/diagnose`);
    // a leaked runtime field must fail the strict parse at the boundary.
    request.flush({ ...synthesis, id: 'should-not-be-here' });

    await expect(promise).rejects.toThrow();
  });

  it('rejects a synthesis response with an invalid status literal', async () => {
    const promise = client.diagnose(deviceId, serviceId);
    const request = httpMock.expectOne(`/api/devices/${deviceId}/services/${serviceId}/diagnose`);
    request.flush({ ...synthesis, status: 'unknown' });

    await expect(promise).rejects.toThrow();
  });
});
