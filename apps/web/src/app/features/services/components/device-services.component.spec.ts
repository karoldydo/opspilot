import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DiagnosisClient } from '@app/features/diagnosis/data/diagnosis.client';
import { DiagnosisStore } from '@app/features/diagnosis/data/diagnosis.store';
import { ServicesClient } from '@app/features/services/data/services.client';
import { ServicesStore } from '@app/features/services/data/services.store';
import { type ServiceStatus } from '@app/shared/status';
import { type RunRecord, type Service } from '@opspilot/shared';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

import { DeviceServicesComponent } from './device-services.component';

const deviceId = '00000000-0000-0000-0000-000000000001';

async function emittedStatus(mocks: ReturnType<typeof makeMocks>): Promise<ServiceStatus> {
  const fixture = setup(mocks);
  const emitted: ServiceStatus[] = [];
  fixture.componentInstance.statusChange.subscribe((status) => emitted.push(status));

  fixture.componentRef.setInput('deviceId', deviceId);
  fixture.componentRef.setInput('deviceName', 'synology');

  // settle in a loop: store.load() then each row's loadRuns() are separate async hops, and the
  // effects that fan them out only re-run on a flush — drain both until the status stops moving.
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  return emitted[emitted.length - 1];
}

// builds mocked component-scoped clients: listServices feeds the services list, recentRuns
// returns the per-service runs that drive each row's latest-run status.
function makeMocks(services: Service[], runsByService: Record<string, RunRecord[]>) {
  const listServices = vi.fn().mockResolvedValue(services);
  const recentRuns = vi.fn((_d: string, serviceId: string) => Promise.resolve(runsByService[serviceId] ?? []));
  return {
    diagnosisClient: { recentRuns, stream: vi.fn() } as unknown as DiagnosisClient,
    listServices,
    recentRuns,
    servicesClient: { listServices } as unknown as ServicesClient,
  };
}

function makeRun(serviceId: string, status: RunRecord['synthesis']['status']): RunRecord {
  return {
    createdAt: '2026-06-11T00:00:00.000Z',
    deviceId,
    id: `run-${serviceId}`,
    serviceId,
    synthesis: { problems: [], status, suggestions: [], summary: `last ${status}` },
  };
}

function makeService(id: string, name: string): Service {
  return {
    composePath: null,
    composeProject: null,
    containerName: name,
    createdAt: '2026-06-11T00:00:00.000Z',
    deviceId,
    id,
    name,
    updatedAt: '2026-06-11T00:00:00.000Z',
  };
}

function setup(mocks: ReturnType<typeof makeMocks>) {
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: HlmDialogService, useValue: { open: vi.fn() } },
    ],
  });
  // the clients + stores are component-scoped providers, so they must be swapped at the component
  // level rather than the module level; the stores stay real so the effects exercise the real flow.
  TestBed.overrideComponent(DeviceServicesComponent, {
    set: {
      providers: [
        { provide: ServicesClient, useValue: mocks.servicesClient },
        ServicesStore,
        { provide: DiagnosisClient, useValue: mocks.diagnosisClient },
        DiagnosisStore,
      ],
    },
  });
  return TestBed.createComponent(DeviceServicesComponent);
}

describe('DeviceServicesComponent worstStatus', () => {
  it('rolls up to the worst status across services (down > degraded > healthy)', async () => {
    const services = [makeService('a', 'svc-a'), makeService('b', 'svc-b'), makeService('c', 'svc-c')];
    const mocks = makeMocks(services, {
      a: [makeRun('a', 'healthy')],
      b: [makeRun('b', 'down')],
      c: [makeRun('c', 'degraded')],
    });

    expect(await emittedStatus(mocks)).toBe('down');
  });

  it('prefers degraded over healthy when no service is down', async () => {
    const services = [makeService('a', 'svc-a'), makeService('b', 'svc-b')];
    const mocks = makeMocks(services, {
      a: [makeRun('a', 'healthy')],
      b: [makeRun('b', 'degraded')],
    });

    expect(await emittedStatus(mocks)).toBe('degraded');
  });

  it('is healthy only when every service with runs is healthy', async () => {
    const services = [makeService('a', 'svc-a'), makeService('b', 'svc-b')];
    const mocks = makeMocks(services, {
      a: [makeRun('a', 'healthy')],
      b: [makeRun('b', 'healthy')],
    });

    expect(await emittedStatus(mocks)).toBe('healthy');
  });

  it('reports unknown when a device has no services', async () => {
    const mocks = makeMocks([], {});

    expect(await emittedStatus(mocks)).toBe('unknown');
  });

  it('treats a service with no runs as unknown, never green', async () => {
    const services = [makeService('a', 'svc-a')];
    const mocks = makeMocks(services, {});

    expect(await emittedStatus(mocks)).toBe('unknown');
  });
});
