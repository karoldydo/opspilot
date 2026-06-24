import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { SkillsClient } from '@app/features/skills/data/skills.client';
import { SkillsStore } from '@app/features/skills/data/skills.store';
import { provideIcons } from '@ng-icons/core';
import { lucideEllipsisVertical } from '@ng-icons/lucide';
import { type Skill } from '@opspilot/shared';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

import { SkillsComponent } from './skills.component';

const skill: Skill = {
  commandTemplate: 'docker restart {{containerName}}',
  createdAt: '2026-06-11T00:00:00.000Z',
  deviceId: null,
  id: '00000000-0000-0000-0000-0000000000c1',
  name: 'restart',
  parameters: [],
  timeoutMs: null,
  updatedAt: '2026-06-11T00:00:00.000Z',
};

// the per-row actions collapsed into a kebab dropdown; the trigger is the only menu-popup
// button in the row, and its items only render into the cdk overlay once it opens.
function kebabTrigger(fixture: ReturnType<typeof setup>): HTMLButtonElement | undefined {
  const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((button) => button.getAttribute('aria-haspopup') === 'menu');
}

function makeMocks() {
  const list = vi.fn().mockResolvedValue([skill]);
  const listDevices = vi.fn().mockResolvedValue([]);
  const skillsClient = { list } as unknown as SkillsClient;
  const devicesClient = { listDevices } as unknown as DevicesClient;
  const dialog = { open: vi.fn() } as unknown as HlmDialogService;
  return { devicesClient, dialog, list, listDevices, skillsClient };
}

function menuItem(label: string): HTMLButtonElement | undefined {
  const overlay = TestBed.inject(OverlayContainer).getContainerElement();
  const buttons = Array.from(overlay.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((button) => button.textContent?.trim() === label);
}

function setup(mocks: ReturnType<typeof makeMocks>) {
  TestBed.configureTestingModule({
    providers: [{ provide: HlmDialogService, useValue: mocks.dialog }],
  });
  // skillsclient/devicesclient are component-scoped providers, so they must be swapped
  // at the component level rather than the module level; the real store stays in place.
  TestBed.overrideComponent(SkillsComponent, {
    set: {
      providers: [
        { provide: SkillsClient, useValue: mocks.skillsClient },
        SkillsStore,
        { provide: DevicesClient, useValue: mocks.devicesClient },
        // re-supply the kebab icon since `set` replaces the component's own provideIcons.
        provideIcons({ lucideEllipsisVertical }),
      ],
    },
  });
  return TestBed.createComponent(SkillsComponent);
}

describe('SkillsComponent', () => {
  it('opens the row kebab and wires the edit item to openEdit', async () => {
    const fixture = setup(makeMocks());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const trigger = kebabTrigger(fixture);
    expect(trigger).toBeDefined();

    const openEdit = vi.spyOn(fixture.componentInstance, 'openEdit');
    trigger?.click();
    fixture.detectChanges();
    // flush the trigger's post-open position timer while the overlay is still alive,
    // so it does not fire against a torn-down overlayRef after the test ends.
    await new Promise((resolve) => setTimeout(resolve));

    // the menu items live in the cdk overlay, rendered only after the trigger opens.
    const edit = menuItem('edit');
    expect(edit).toBeDefined();
    edit?.click();
    // the table row is the skill enriched with a derived scope label, so match by identity.
    expect(openEdit).toHaveBeenCalledWith(expect.objectContaining({ id: skill.id }));
  });

  it('exposes a destructive delete item wired to requestDelete', async () => {
    const fixture = setup(makeMocks());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const requestDelete = vi.spyOn(fixture.componentInstance, 'requestDelete');
    kebabTrigger(fixture)?.click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));

    const remove = menuItem('delete');
    expect(remove).toBeDefined();
    // the destructive variant surfaces through the helm item's data attribute.
    expect(remove?.getAttribute('data-variant')).toBe('destructive');
    remove?.click();
    expect(requestDelete).toHaveBeenCalled();
  });
});
