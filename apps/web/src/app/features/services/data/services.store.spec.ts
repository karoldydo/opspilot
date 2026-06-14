import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ServicesClient } from '@app/features/services/data/services.client';
import { type ScannedContainer, type Service } from '@opspilot/shared';

import { ServicesStore } from './services.store';

const deviceId = '00000000-0000-0000-0000-000000000001';

const service: Service = {
  composePath: null,
  composeProject: null,
  containerName: 'nginx',
  createdAt: '2026-06-10T00:00:00.000Z',
  deviceId,
  id: '00000000-0000-0000-0000-0000000000aa',
  name: 'nginx',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

const container: ScannedContainer = {
  composePath: null,
  composeProject: null,
  containerName: 'nginx',
  image: 'nginx:latest',
  state: 'running',
  status: 'Up 2 hours',
};

const other: ScannedContainer = { ...container, containerName: 'redis', image: 'redis:7' };

function apiError(message: string, status: number): HttpErrorResponse {
  return new HttpErrorResponse({ error: { message, status, timestamp: '2026-06-10T00:00:00.000Z' }, status });
}

function setup(client: Partial<ServicesClient>): ServicesStore {
  TestBed.configureTestingModule({
    providers: [{ provide: ServicesClient, useValue: client }, ServicesStore],
  });
  return TestBed.inject(ServicesStore);
}

describe('ServicesStore', () => {
  it('loads the managed services for a device', async () => {
    const listServices = vi.fn().mockResolvedValue([service]);
    const store = setup({ listServices });

    await store.load(deviceId);

    expect(listServices).toHaveBeenCalledWith(deviceId);
    expect(store.services()).toEqual([service]);
    expect(store.isEmpty()).toBe(false);
  });

  it('populates the ephemeral scan signal on runScan', async () => {
    const scan = vi.fn().mockResolvedValue({ containers: [container, other] });
    const store = setup({ scan });

    const result = await store.runScan(deviceId);

    expect(result).toEqual({ error: null });
    expect(scan).toHaveBeenCalledWith(deviceId);
    expect(store.scan()).toEqual([container, other]);
  });

  it('surfaces a scan failure as the error message', async () => {
    const scan = vi.fn().mockRejectedValue(apiError('Cannot connect to the Docker daemon', 503));
    const store = setup({ scan });

    const result = await store.runScan(deviceId);

    expect(result).toEqual({ error: 'Cannot connect to the Docker daemon' });
    expect(store.error()).toBe('Cannot connect to the Docker daemon');
    expect(store.scan()).toBeNull();
  });

  it('creates each selected container then refetches the list', async () => {
    const createService = vi.fn().mockResolvedValue(service);
    const listServices = vi.fn().mockResolvedValue([service]);
    const store = setup({ createService, listServices });

    const result = await store.addSelected(deviceId, [container]);

    expect(result).toEqual({ error: null });
    expect(createService).toHaveBeenCalledWith(deviceId, {
      composePath: null,
      composeProject: null,
      containerName: 'nginx',
      deviceId,
      name: 'nginx',
    });
    expect(listServices).toHaveBeenCalledWith(deviceId);
    expect(store.services()).toEqual([service]);
  });

  it('reports which containers failed but keeps the successes and refetches', async () => {
    const createService = vi
      .fn()
      .mockResolvedValueOnce(service)
      .mockRejectedValueOnce(apiError('service nginx already exists on device', 409));
    const listServices = vi.fn().mockResolvedValue([service]);
    const store = setup({ createService, listServices });

    const result = await store.addSelected(deviceId, [other, container]);

    // the second create (nginx) rejects — its name is reported, redis still lands.
    expect(result).toEqual({ error: 'could not add: nginx' });
    expect(createService).toHaveBeenCalledTimes(2);
    // the list is refetched regardless so the successful add shows immediately.
    expect(listServices).toHaveBeenCalledWith(deviceId);
    expect(store.services()).toEqual([service]);
  });

  it('renames a service then refetches', async () => {
    const updateService = vi.fn().mockResolvedValue({ ...service, name: 'web' });
    const listServices = vi.fn().mockResolvedValue([{ ...service, name: 'web' }]);
    const store = setup({ listServices, updateService });

    const result = await store.rename(deviceId, service.id, 'web');

    expect(result).toEqual({ error: null });
    expect(updateService).toHaveBeenCalledWith(deviceId, service.id, { name: 'web' });
    expect(listServices).toHaveBeenCalledWith(deviceId);
  });

  it('keeps state untouched and surfaces the error when a rename fails', async () => {
    const updateService = vi.fn().mockRejectedValue(apiError('name is required', 400));
    const listServices = vi.fn();
    const store = setup({ listServices, updateService });

    const result = await store.rename(deviceId, service.id, '');

    expect(result).toEqual({ error: 'name is required' });
    // a failed mutation never refetches.
    expect(listServices).not.toHaveBeenCalled();
  });

  it('removes a service then refetches', async () => {
    const removeService = vi.fn().mockResolvedValue(undefined);
    const listServices = vi.fn().mockResolvedValue([]);
    const store = setup({ listServices, removeService });

    const result = await store.remove(deviceId, service.id);

    expect(result).toEqual({ error: null });
    expect(removeService).toHaveBeenCalledWith(deviceId, service.id);
    expect(listServices).toHaveBeenCalledWith(deviceId);
  });
});
