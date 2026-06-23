import { TestBed } from '@angular/core/testing';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { SkillsClient } from '@app/features/skills/data/skills.client';
import { SkillsStore } from '@app/features/skills/data/skills.store';
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

function makeMocks() {
  const list = vi.fn().mockResolvedValue([skill]);
  const listDevices = vi.fn().mockResolvedValue([]);
  const skillsClient = { list } as unknown as SkillsClient;
  const devicesClient = { listDevices } as unknown as DevicesClient;
  const dialog = { open: vi.fn() } as unknown as HlmDialogService;
  return { devicesClient, dialog, list, listDevices, skillsClient };
}

function rowButton(fixture: ReturnType<typeof setup>, label: string): HTMLButtonElement | undefined {
  const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
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
      ],
    },
  });
  return TestBed.createComponent(SkillsComponent);
}

describe('SkillsComponent', () => {
  it('applies the secondary clickable affordance to the edit button', async () => {
    const fixture = setup(makeMocks());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const edit = rowButton(fixture, 'edit');
    expect(edit).toBeDefined();
    // the opClickable directive (secondary variant) renders the shared surface affordance
    // plus the bordered hover — this is the regression guard for the directive being wired in.
    expect(edit?.classList.contains('cursor-pointer')).toBe(true);
    expect(edit?.classList.contains('hover:bg-op-surface-card')).toBe(true);
    expect(edit?.classList.contains('focus-visible:ring-op-ink')).toBe(true);
    expect(edit?.classList.contains('hover:border-op-hairline-strong')).toBe(true);
    // existing static color classes are preserved, not clobbered.
    expect(edit?.classList.contains('bg-op-cream')).toBe(true);
  });

  it('applies the danger clickable affordance to the delete button', async () => {
    const fixture = setup(makeMocks());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const remove = rowButton(fixture, 'del');
    expect(remove).toBeDefined();
    expect(remove?.classList.contains('cursor-pointer')).toBe(true);
    expect(remove?.classList.contains('focus-visible:ring-op-danger')).toBe(true);
    expect(remove?.classList.contains('focus-visible:ring-op-ink')).toBe(false);
  });
});
