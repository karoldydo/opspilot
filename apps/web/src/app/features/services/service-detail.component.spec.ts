import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { DiagnosisClient } from '@app/features/diagnosis/data/diagnosis.client';
import { DiagnosisStore } from '@app/features/diagnosis/data/diagnosis.store';
import { ServicesClient } from '@app/features/services/data/services.client';
import { ServicesStore } from '@app/features/services/data/services.store';
import { type Device, type RunRecord, type Service } from '@opspilot/shared';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { of } from 'rxjs';

import { ServiceDetailComponent } from './service-detail.component';

const deviceId = '00000000-0000-0000-0000-000000000001';
const serviceId = '00000000-0000-0000-0000-0000000000aa';

const service: Service = {
  composePath: '/srv/app/docker-compose.yml',
  composeProject: 'app',
  containerName: 'app',
  createdAt: '2026-06-11T00:00:00.000Z',
  deviceId,
  id: serviceId,
  name: 'app',
  updatedAt: '2026-06-11T00:00:00.000Z',
};

const device: Device = {
  agentContext: null,
  createdAt: '2026-06-11T00:00:00.000Z',
  host: 'nas.local',
  id: deviceId,
  name: 'synology',
  updatedAt: '2026-06-11T00:00:00.000Z',
};

// the uppercase status badge in the identity header (the first badge-styled span).
function headerBadge(fixture: ReturnType<typeof setup>): HTMLElement | null {
  return fixture.nativeElement.querySelector('h1 + span');
}

function makeMocks(runs: RunRecord[] = []) {
  const getService = vi.fn().mockResolvedValue(service);
  const listDevices = vi.fn().mockResolvedValue([device]);
  const recentRuns = vi.fn().mockResolvedValue(runs);
  return {
    devicesClient: { listDevices } as unknown as DevicesClient,
    diagnosisClient: { recentRuns, stream: vi.fn() } as unknown as DiagnosisClient,
    getService,
    listDevices,
    recentRuns,
    servicesClient: { getService } as unknown as ServicesClient,
  };
}

function makeRun(status: RunRecord['synthesis']['status']): RunRecord {
  return {
    createdAt: '2026-06-11T00:00:00.000Z',
    deviceId,
    id: '00000000-0000-0000-0000-0000000000f1',
    serviceId,
    synthesis: { problems: [], status, suggestions: [], summary: `last ${status}` },
  };
}

function setup(mocks: ReturnType<typeof makeMocks>) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ deviceId, serviceId })) } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: HlmDialogService, useValue: { open: vi.fn() } },
    ],
  });
  // the clients + stores are component-scoped providers, so they must be swapped at the component
  // level rather than the module level; the stores stay real so the effects exercise the real flow.
  TestBed.overrideComponent(ServiceDetailComponent, {
    set: {
      providers: [
        { provide: ServicesClient, useValue: mocks.servicesClient },
        ServicesStore,
        { provide: DiagnosisClient, useValue: mocks.diagnosisClient },
        DiagnosisStore,
        { provide: DevicesClient, useValue: mocks.devicesClient },
      ],
    },
  });
  return TestBed.createComponent(ServiceDetailComponent);
}

describe('ServiceDetailComponent', () => {
  it('resolves the service + runs from effects after the route ids bind, not in the constructor', async () => {
    const mocks = makeMocks();
    const fixture = setup(mocks);

    // before the first change detection the effects have not run — the resolve is effect-driven,
    // never a constructor read of the route ids (ng0950).
    expect(mocks.getService).not.toHaveBeenCalled();
    expect(mocks.recentRuns).not.toHaveBeenCalled();

    fixture.detectChanges();
    await fixture.whenStable();

    expect(mocks.getService).toHaveBeenCalledWith(deviceId, serviceId);
    expect(mocks.recentRuns).toHaveBeenCalledWith(deviceId, serviceId);
  });

  it('seeds the header status from the latest run when there is no live result', async () => {
    const mocks = makeMocks([makeRun('degraded')]);
    const fixture = setup(mocks);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const badge = headerBadge(fixture);
    expect(badge?.textContent?.trim()).toBe('degraded');
    // the latest-run status drives the badge colour — never the neutral unknown grey.
    expect(badge?.className).not.toContain('text-op-mute');
  });

  it('renders a neutral grey unknown status for a service with no runs, never green', async () => {
    const mocks = makeMocks([]);
    const fixture = setup(mocks);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const badge = headerBadge(fixture);
    expect(badge?.textContent?.trim()).toBe('unknown');
    expect(badge?.className).toContain('bg-op-surface-card');
    expect(badge?.className).not.toContain('bg-op-success-text');
  });
});
