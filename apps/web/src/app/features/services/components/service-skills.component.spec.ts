import { TestBed } from '@angular/core/testing';
import { SkillRunClient } from '@app/features/services/data/skill-run.client';
import { SkillRunStore } from '@app/features/services/data/skill-run.store';
import { RunSkillDialog } from '@app/features/services/dialogs/run-skill.dialog';
import { SkillsClient } from '@app/features/skills/data/skills.client';
import { type Service, type Skill } from '@opspilot/shared';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

import { ServiceSkillsComponent } from './service-skills.component';

const deviceId = '00000000-0000-0000-0000-000000000001';

const service: Service = {
  composePath: '/srv/app/docker-compose.yml',
  composeProject: 'app',
  containerName: 'app',
  createdAt: '2026-06-11T00:00:00.000Z',
  deviceId,
  id: '00000000-0000-0000-0000-0000000000aa',
  name: 'app',
  updatedAt: '2026-06-11T00:00:00.000Z',
};

function makeSkill(id: string, name: string): Skill {
  return {
    commandTemplate: `docker {{containerName}}`,
    createdAt: '2026-06-11T00:00:00.000Z',
    deviceId: null,
    id,
    name,
    parameters: [],
    timeoutMs: null,
    updatedAt: '2026-06-11T00:00:00.000Z',
  };
}

const startSkill = makeSkill('00000000-0000-0000-0000-0000000000c1', 'start');
const restartSkill = makeSkill('00000000-0000-0000-0000-0000000000c2', 'restart');

function makeMocks() {
  const listForDevice = vi.fn().mockResolvedValue([startSkill, restartSkill]);
  const open = vi.fn();
  const skillsClient = { listForDevice } as unknown as SkillsClient;
  const skillRunClient = { run: vi.fn() } as unknown as SkillRunClient;
  const dialog = { open } as unknown as HlmDialogService;
  return { dialog, listForDevice, open, skillRunClient, skillsClient };
}

function setup(mocks: ReturnType<typeof makeMocks>) {
  TestBed.configureTestingModule({
    providers: [{ provide: HlmDialogService, useValue: mocks.dialog }],
  });
  // skillsclient/skillrunclient/skillrunstore are component-scoped providers, so they must be
  // swapped at the component level rather than the module level.
  TestBed.overrideComponent(ServiceSkillsComponent, {
    set: {
      providers: [
        { provide: SkillsClient, useValue: mocks.skillsClient },
        { provide: SkillRunClient, useValue: mocks.skillRunClient },
        SkillRunStore,
      ],
    },
  });
  return TestBed.createComponent(ServiceSkillsComponent);
}

function skillButtons(fixture: ReturnType<typeof setup>): HTMLButtonElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('button'));
}

describe('ServiceSkillsComponent', () => {
  it('fetches skills for the bound device only after inputs bind, not in the constructor', async () => {
    const mocks = makeMocks();
    const fixture = setup(mocks);

    // before inputs bind there is no fetch — the pre-fix constructor load would have either
    // thrown ng0950 (swallowed) or fired here; either way this assertion is the regression guard.
    expect(mocks.listForDevice).not.toHaveBeenCalled();

    fixture.componentRef.setInput('deviceId', deviceId);
    fixture.componentRef.setInput('service', service);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mocks.listForDevice).toHaveBeenCalledWith(deviceId);
  });

  it('renders one button per visible skill', async () => {
    const mocks = makeMocks();
    const fixture = setup(mocks);

    fixture.componentRef.setInput('deviceId', deviceId);
    fixture.componentRef.setInput('service', service);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const labels = skillButtons(fixture).map((button) => button.textContent?.trim());
    expect(labels).toEqual(['start', 'restart']);
  });

  it('opens the run dialog with the right context when a skill button is clicked', async () => {
    const mocks = makeMocks();
    const fixture = setup(mocks);

    fixture.componentRef.setInput('deviceId', deviceId);
    fixture.componentRef.setInput('service', service);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const restartButton = skillButtons(fixture).find((button) => button.textContent?.trim() === 'restart');
    restartButton?.click();

    expect(mocks.open).toHaveBeenCalledWith(
      RunSkillDialog,
      expect.objectContaining({
        context: expect.objectContaining({
          deviceId,
          serviceId: service.id,
          skill: restartSkill,
        }),
      })
    );
  });

  it('leaves the row rendered with no skill buttons and logs when the skills fetch rejects', async () => {
    const mocks = makeMocks();
    mocks.listForDevice.mockRejectedValueOnce(new Error('network down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = setup(mocks);

    fixture.componentRef.setInput('deviceId', deviceId);
    fixture.componentRef.setInput('service', service);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(skillButtons(fixture)).toHaveLength(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
