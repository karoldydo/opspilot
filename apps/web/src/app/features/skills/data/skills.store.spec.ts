import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { SkillsClient } from '@app/features/skills/data/skills.client';
import { type Skill } from '@opspilot/shared';

import { SkillsStore } from './skills.store';

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

function apiError(message: string, status: number): HttpErrorResponse {
  return new HttpErrorResponse({ error: { message, status, timestamp: '2026-06-10T00:00:00.000Z' }, status });
}

function setup(client: Partial<SkillsClient>): SkillsStore {
  TestBed.configureTestingModule({
    providers: [{ provide: SkillsClient, useValue: client }, SkillsStore],
  });
  return TestBed.inject(SkillsStore);
}

describe('SkillsStore', () => {
  it('creates a skill then refetches on success', async () => {
    const create = vi.fn().mockResolvedValue(skill);
    const list = vi.fn().mockResolvedValue([skill]);
    const store = setup({ create, list });

    const result = await store.create({
      commandTemplate: skill.commandTemplate,
      deviceId: null,
      name: skill.name,
      parameters: skill.parameters,
      timeoutMs: null,
    });

    expect(result).toEqual({ error: null });
    expect(create).toHaveBeenCalledOnce();
    // mutate-then-refetch: a successful create reloads the list.
    expect(list).toHaveBeenCalledOnce();
    expect(store.skills()).toEqual([skill]);
  });

  it('surfaces the conflict and does not refetch when create fails', async () => {
    const create = vi.fn().mockRejectedValue(apiError('skill named restart already exists in this scope', 409));
    const list = vi.fn();
    const store = setup({ create, list });

    const result = await store.create({
      commandTemplate: skill.commandTemplate,
      deviceId: null,
      name: skill.name,
      parameters: skill.parameters,
      timeoutMs: null,
    });

    expect(result).toEqual({ error: 'skill named restart already exists in this scope' });
    // a failed create never refetches — the list stays as it was.
    expect(list).not.toHaveBeenCalled();
    expect(store.skills()).toEqual([]);
  });

  it('updates a skill then refetches on success', async () => {
    const update = vi.fn().mockResolvedValue(skill);
    const list = vi.fn().mockResolvedValue([skill]);
    const store = setup({ list, update });

    const result = await store.update(skill.id, { name: 'restart-now' });

    expect(result).toEqual({ error: null });
    expect(update).toHaveBeenCalledWith(skill.id, { name: 'restart-now' });
    expect(list).toHaveBeenCalledOnce();
  });

  it('removes a skill then refetches on success', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue([]);
    const store = setup({ list, remove });

    const result = await store.remove(skill.id);

    expect(result).toEqual({ error: null });
    expect(remove).toHaveBeenCalledWith(skill.id);
    expect(list).toHaveBeenCalledOnce();
  });
});
