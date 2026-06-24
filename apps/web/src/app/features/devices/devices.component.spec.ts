import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { DevicesStore } from '@app/features/devices/data/devices.store';
import { FleetServicesClient } from '@app/features/devices/data/fleet-services.client';
import { ServicesClient } from '@app/features/services/data/services.client';
import { ServicesStore } from '@app/features/services/data/services.store';
import { type Device } from '@opspilot/shared';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

import { DevicesComponent } from './devices.component';

const device: Device = {
  agentContext: null,
  createdAt: '2026-06-11T00:00:00.000Z',
  host: 'nas.local',
  id: '00000000-0000-0000-0000-000000000001',
  name: 'synology',
  updatedAt: '2026-06-11T00:00:00.000Z',
};

// the trimmed text of every <button> currently rendered — used to assert the host-action
// buttons (scan / edit host / delete host) are present or absent for a given bar state.
function buttonTexts(fixture: ReturnType<typeof setup>): string[] {
  return Array.from(fixture.nativeElement.querySelectorAll('button')).map(
    (button) => (button as HTMLElement).textContent?.trim() ?? ''
  );
}

function makeMocks() {
  const listDevices = vi.fn().mockResolvedValue([device]);
  const listAll = vi.fn().mockResolvedValue([]);
  return {
    devicesClient: { listDevices } as unknown as DevicesClient,
    fleetClient: { listAll } as unknown as FleetServicesClient,
    listAll,
    listDevices,
    servicesClient: {} as unknown as ServicesClient,
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
  // level; the stores stay real so the host strip + selectedDevice() flow is exercised for real.
  TestBed.overrideComponent(DevicesComponent, {
    set: {
      providers: [
        { provide: DevicesClient, useValue: mocks.devicesClient },
        DevicesStore,
        { provide: FleetServicesClient, useValue: mocks.fleetClient },
        { provide: ServicesClient, useValue: mocks.servicesClient },
        ServicesStore,
      ],
    },
  });
  return TestBed.createComponent(DevicesComponent);
}

describe('DevicesComponent host action bar', () => {
  it('shows the muted scan hint and no host-action buttons when all hosts is selected', async () => {
    const fixture = setup(makeMocks());

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // the hint must name scan so the affordance is discoverable from the default view.
    expect(fixture.nativeElement.textContent).toContain('select a host above to');
    expect(fixture.nativeElement.textContent).toContain('scan');

    // but no host-action buttons — scan/edit/delete each need a target host.
    const texts = buttonTexts(fixture);
    expect(texts).not.toContain('scan');
    expect(texts).not.toContain('edit host');
    expect(texts).not.toContain('delete host');
  });

  it('reveals managing … plus scan / edit host / delete host once a host is selected', async () => {
    const fixture = setup(makeMocks());

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // drive the host filter the way a chip click would, then re-render the bar.
    fixture.componentInstance.selectHost(device.id);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('managing');
    expect(fixture.nativeElement.textContent).toContain(device.name);

    const texts = buttonTexts(fixture);
    expect(texts).toContain('scan');
    expect(texts).toContain('edit host');
    expect(texts).toContain('delete host');
  });
});
