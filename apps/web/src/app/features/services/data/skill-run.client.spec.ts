import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SkillRunClient } from './skill-run.client';

const deviceId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const skillId = '33333333-3333-4333-8333-333333333333';

describe('SkillRunClient', () => {
  let client: SkillRunClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SkillRunClient],
    });
    client = TestBed.inject(SkillRunClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('posts the inputs to the nested run route and parses the result at the boundary', async () => {
    const promise = client.run(deviceId, serviceId, skillId, { inputs: { tag: 'latest' } });
    const request = httpMock.expectOne(`/api/devices/${deviceId}/services/${serviceId}/skills/${skillId}/run`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ inputs: { tag: 'latest' } });
    request.flush({ message: 'started', status: 'succeeded' });

    const result = await promise;
    expect(result).toEqual({ message: 'started', status: 'succeeded' });
  });

  it('rejects a result carrying a leaked unknown key', async () => {
    const promise = client.run(deviceId, serviceId, skillId, { inputs: {} });
    const request = httpMock.expectOne(`/api/devices/${deviceId}/services/${serviceId}/skills/${skillId}/run`);
    // a leaked key must fail the strict parse at the boundary.
    request.flush({ extra: 'leak', message: 'started', status: 'succeeded' });

    await expect(promise).rejects.toThrow();
  });
});
