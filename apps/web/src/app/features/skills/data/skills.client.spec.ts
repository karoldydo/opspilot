import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type Skill } from '@opspilot/shared';

import { SkillsClient } from './skills.client';

const skill: Skill = {
  commandTemplate: 'docker restart {{containerName}}',
  createdAt: '2026-06-10T00:00:00.000Z',
  deviceId: null,
  id: '44444444-4444-4444-8444-444444444444',
  name: 'restart',
  parameters: [{ name: 'containerName', required: true, source: 'service' }],
  timeoutMs: null,
  updatedAt: '2026-06-10T00:00:00.000Z',
};

describe('SkillsClient', () => {
  let client: SkillsClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SkillsClient],
    });
    client = TestBed.inject(SkillsClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('parses a skill list at the boundary', async () => {
    const promise = client.list();
    const request = httpMock.expectOne('/api/skills');
    expect(request.request.method).toBe('GET');
    request.flush([skill]);

    const result = await promise;
    expect(result).toEqual([skill]);
  });

  it('rejects a response carrying a leaked column', async () => {
    const promise = client.create({
      commandTemplate: skill.commandTemplate,
      deviceId: null,
      name: skill.name,
      parameters: skill.parameters,
      timeoutMs: null,
    });
    const request = httpMock.expectOne('/api/skills');
    expect(request.request.method).toBe('POST');
    // a leaked key must fail the strict parse at the boundary.
    request.flush({ ...skill, secretColumn: 'leak' });

    await expect(promise).rejects.toThrow();
  });
});
