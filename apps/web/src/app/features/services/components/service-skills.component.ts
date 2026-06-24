import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { SkillRunClient } from '@app/features/services/data/skill-run.client';
import { SkillRunStore } from '@app/features/services/data/skill-run.store';
import { RunSkillDialog, type RunSkillDialogContext } from '@app/features/services/dialogs/run-skill.dialog';
import { SkillsClient } from '@app/features/skills/data/skills.client';
import { type Service, type Skill, type SkillParameter } from '@opspilot/shared';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

// run affordance for one service row: lists the in-scope skills whose required `service` params are satisfiable, reproducing the old canCompose() gating. owns its client + run store (provided here, not providedIn: 'root', per angular.md) keyed by serviceId so one row's run never bleeds into another.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  // display: contents so the inner block joins the actions cell's flex row instead of nesting a stray inline host box.
  host: { class: 'contents' },
  imports: [HlmButton],
  providers: [SkillsClient, SkillRunClient, SkillRunStore],
  selector: 'app-service-skills',
  templateUrl: './service-skills.component.html',
})
export class ServiceSkillsComponent {
  private readonly dialog = inject(HlmDialogService);
  private readonly skillsClient = inject(SkillsClient);

  readonly deviceId = input.required<string>();

  readonly service = input.required<Service>();

  protected readonly store = inject(SkillRunStore);

  protected readonly entry = computed(() => this.store.entry(this.service().id));

  // every skill fetched from /api/skills (global + per-device); filtered to scope + gating in visibleSkills below.
  private readonly skills = signal<Skill[]>([]);

  // skills runnable on this service: in scope for its device, and every required `service` param satisfiable on the resolved service row (composePath/composeProject are null on a standalone container — so up/down hide there, exactly as canCompose() did).
  protected readonly visibleSkills = computed(() => {
    const deviceId = this.deviceId();
    const service = this.service();
    return this.skills().filter(
      (skill) =>
        (skill.deviceId === null || skill.deviceId === deviceId) &&
        skill.parameters.every((parameter) => this.satisfiable(parameter, service))
    );
  });

  // load runs after inputs bind — the constructor is too early for a required input (reading it throws ng0950). uses an effect-driven load.
  private readonly loadEffect = effect(() => {
    void this.load(this.deviceId());
  });

  // opens the uniform run dialog for one skill; the store keys the pending/result by
  // serviceId so the row's result line tracks it, and the dialog stays open on error.
  openRun(skill: Skill): void {
    const context: RunSkillDialogContext = {
      deviceId: this.deviceId(),
      serviceId: this.service().id,
      serviceName: this.service().name,
      skill,
      store: this.store,
    };
    this.dialog.open(RunSkillDialog, { context });
  }

  private async load(deviceId: string): Promise<void> {
    try {
      this.skills.set(await this.skillsClient.listForDevice(deviceId));
    } catch (error) {
      // a skill fetch failure must not break the row — it just shows no run controls.
      // log it though: an empty catch here once hid a constructor-timing bug for months.
      console.error('failed to load skills for device', deviceId, error);
    }
  }

  // a required `service` param is satisfiable only when its bound field is non-null on
  // the service; an `input` or non-required param never gates.
  private satisfiable(parameter: SkillParameter, service: Service): boolean {
    if (parameter.source !== 'service' || !parameter.required) {
      return true;
    }
    if (parameter.name === 'composePath') {
      return service.composePath !== null;
    }
    if (parameter.name === 'composeProject') {
      return service.composeProject !== null;
    }
    // containerName (the only other service field) is always present.
    return true;
  }
}
