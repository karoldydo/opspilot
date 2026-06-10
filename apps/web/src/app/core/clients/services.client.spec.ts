import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type Service } from '@opspilot/shared';

import { ServicesClient } from './services.client';

const deviceId = '11111111-1111-4111-8111-111111111111';

const service: Service = {
  composePath: null,
  composeProject: null,
  containerName: 'nginx',
  createdAt: '2026-06-10T00:00:00.000Z',
  deviceId,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'nginx',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

describe('ServicesClient', () => {
  let client: ServicesClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ServicesClient],
    });
    client = TestBed.inject(ServicesClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('parses the scan result at the boundary', async () => {
    const promise = client.scan(deviceId);
    const request = httpMock.expectOne(`/api/devices/${deviceId}/scan`);
    expect(request.request.method).toBe('POST');
    request.flush({
      containers: [
        {
          composePath: null,
          composeProject: null,
          containerName: 'nginx',
          image: 'nginx:latest',
          state: 'running',
          status: 'Up',
        },
      ],
    });

    const result = await promise;
    expect(result.containers[0].containerName).toBe('nginx');
  });

  it('rejects a service response carrying a leaked unknown key', async () => {
    const promise = client.createService(deviceId, { containerName: 'nginx', deviceId, name: 'nginx' });
    const request = httpMock.expectOne(`/api/devices/${deviceId}/services`);
    expect(request.request.method).toBe('POST');
    // a leaked runtime/secret field must fail the strict parse at the boundary.
    request.flush({ ...service, status: 'Up 2 hours' });

    await expect(promise).rejects.toThrow();
  });

  it('parses a managed-services list at the boundary', async () => {
    const promise = client.listServices(deviceId);
    const request = httpMock.expectOne(`/api/devices/${deviceId}/services`);
    expect(request.request.method).toBe('GET');
    request.flush([service]);

    const result = await promise;
    expect(result).toEqual([service]);
  });
});
