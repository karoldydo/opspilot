import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { type Credential, type Device } from '@opspilot/shared';

import { DevicesClient } from '../clients/devices.client';
import { DevicesStore } from './devices.store';

const device: Device = {
  agentContext: null,
  createdAt: '2026-06-10T00:00:00.000Z',
  host: '192.168.1.10',
  id: '00000000-0000-0000-0000-000000000001',
  name: 'web-01',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

const credential: Credential = {
  authType: 'password',
  createdAt: '2026-06-10T00:00:00.000Z',
  deviceId: device.id,
  id: '00000000-0000-0000-0000-0000000000aa',
  updatedAt: '2026-06-10T00:00:00.000Z',
  username: 'root',
};

function apiError(message: string, status: number): HttpErrorResponse {
  return new HttpErrorResponse({ error: { message, status, timestamp: '2026-06-10T00:00:00.000Z' }, status });
}

function setup(client: Partial<DevicesClient>): DevicesStore {
  TestBed.configureTestingModule({
    providers: [{ provide: DevicesClient, useValue: client }, DevicesStore],
  });
  return TestBed.inject(DevicesStore);
}

describe('DevicesStore', () => {
  it('creates a device then its credential and refetches on success', async () => {
    const createDevice = vi.fn().mockResolvedValue(device);
    const createCredential = vi.fn().mockResolvedValue(credential);
    const removeDevice = vi.fn();
    const listDevices = vi.fn().mockResolvedValue([device]);
    const store = setup({ createCredential, createDevice, listDevices, removeDevice });

    const result = await store.add(
      { host: device.host, name: device.name },
      { authType: 'password', secret: 'hunter2', username: 'root' }
    );

    expect(result).toEqual({ error: null });
    expect(createDevice).toHaveBeenCalledWith({ host: device.host, name: device.name });
    expect(createCredential).toHaveBeenCalledWith(device.id, {
      authType: 'password',
      deviceId: device.id,
      secret: 'hunter2',
      username: 'root',
    });
    expect(removeDevice).not.toHaveBeenCalled();
    expect(listDevices).toHaveBeenCalledOnce();
    expect(store.devices()).toEqual([device]);
  });

  it('rolls back the orphaned device when the credential call fails', async () => {
    const createDevice = vi.fn().mockResolvedValue(device);
    const createCredential = vi.fn().mockRejectedValue(apiError('secret is required', 400));
    const removeDevice = vi.fn().mockResolvedValue(undefined);
    const listDevices = vi.fn().mockResolvedValue([]);
    const store = setup({ createCredential, createDevice, listDevices, removeDevice });

    const result = await store.add(
      { host: device.host, name: device.name },
      { authType: 'password', secret: '', username: 'root' }
    );

    expect(result).toEqual({ error: 'secret is required' });
    expect(removeDevice).toHaveBeenCalledWith(device.id);
    // a failed create never refetches — the list stays as it was.
    expect(listDevices).not.toHaveBeenCalled();
    expect(store.devices()).toEqual([]);
  });

  it('surfaces a device-create failure without touching credentials', async () => {
    const createDevice = vi.fn().mockRejectedValue(apiError('name is required', 400));
    const createCredential = vi.fn();
    const removeDevice = vi.fn();
    const store = setup({ createCredential, createDevice, removeDevice });

    const result = await store.add(
      { host: device.host, name: '' },
      { authType: 'password', secret: 'hunter2', username: 'root' }
    );

    expect(result).toEqual({ error: 'name is required' });
    expect(createCredential).not.toHaveBeenCalled();
    expect(removeDevice).not.toHaveBeenCalled();
  });

  it('replaces a credential by creating the new one then deleting the old', async () => {
    const newCredential: Credential = { ...credential, id: '00000000-0000-0000-0000-0000000000bb' };
    const listCredentials = vi.fn().mockResolvedValue([credential]);
    const removeCredential = vi.fn().mockResolvedValue(undefined);
    const createCredential = vi.fn().mockResolvedValue(newCredential);
    const listDevices = vi.fn().mockResolvedValue([device]);
    const store = setup({ createCredential, listCredentials, listDevices, removeCredential });

    const result = await store.replaceCredential(device.id, {
      authType: 'key',
      secret: 'ssh-key-material',
      username: 'ops',
    });

    expect(result).toEqual({ error: null });
    expect(createCredential).toHaveBeenCalledWith(device.id, {
      authType: 'key',
      deviceId: device.id,
      secret: 'ssh-key-material',
      username: 'ops',
    });
    // the prior credential is dropped only after the new one is created.
    expect(removeCredential).toHaveBeenCalledWith(device.id, credential.id);
  });

  it('keeps the existing credential when the replacement create fails', async () => {
    const listCredentials = vi.fn().mockResolvedValue([credential]);
    const removeCredential = vi.fn();
    const createCredential = vi.fn().mockRejectedValue(apiError('secret is required', 400));
    const listDevices = vi.fn();
    const store = setup({ createCredential, listCredentials, listDevices, removeCredential });

    const result = await store.replaceCredential(device.id, { authType: 'key', secret: '', username: 'ops' });

    expect(result).toEqual({ error: 'secret is required' });
    // create-then-delete: a failed create never removes the old credential.
    expect(removeCredential).not.toHaveBeenCalled();
    expect(listDevices).not.toHaveBeenCalled();
  });
});
