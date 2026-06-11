import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ServiceOperationsClient } from './service-operations.client';

const deviceId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';

describe('ServiceOperationsClient', () => {
  let client: ServiceOperationsClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ServiceOperationsClient],
    });
    client = TestBed.inject(ServiceOperationsClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('posts the operation and parses the result at the boundary', async () => {
    const promise = client.run(deviceId, serviceId, 'restart');
    const request = httpMock.expectOne(`/api/devices/${deviceId}/services/${serviceId}/operations`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ operation: 'restart' });
    request.flush({ message: 'restarted', operation: 'restart', status: 'succeeded' });

    const result = await promise;
    expect(result).toEqual({ message: 'restarted', operation: 'restart', status: 'succeeded' });
  });

  it('rejects a result carrying a leaked unknown key', async () => {
    const promise = client.run(deviceId, serviceId, 'start');
    const request = httpMock.expectOne(`/api/devices/${deviceId}/services/${serviceId}/operations`);
    // a leaked field must fail the strict parse at the boundary.
    request.flush({ extra: 'leak', message: 'started', operation: 'start', status: 'succeeded' });

    await expect(promise).rejects.toThrow();
  });
});
