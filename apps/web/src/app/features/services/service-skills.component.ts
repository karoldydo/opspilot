import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { type Service, type Skill, type SkillParameter } from '@opspilot/shared';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

import { SkillRunClient } from '../../core/clients/skill-run.client';
import { SkillsClient } from '../../core/clients/skills.client';
import { SkillRunStore } from '../../core/stores/skill-run.store';
import { RunSkillDialog, type RunSkillDialogContext } from './run-skill.dialog';

// the run affordance for one service row, replacing the fixed-enum service-operations
// surface. it lists the skills in scope for this service's device (global + that
// device's) gated to those whose required `service` params are satisfiable for the
// service — this reproduces the old canCompose() gating for up/down without special-
// casing. each skill runs through a uniform dialog (command preview + any `input`
// params + confirm), so a destructive skill is confirmed without needing a flag the
// data model doesn't carry. owns its own client + run store (provided here, not
// providedIn: 'root', per angular.md) keyed by serviceId so one row's pending/result
// never bleeds into another.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  // display: contents so the inner block participates directly in the actions cell's
  // flex row rather than nesting a stray inline host box.
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

  // this row's current run slice (pending/result/error); reads the store signal so
  // the template tracks it.
  protected readonly entry = computed(() => this.store.entry(this.service().id));

  // every skill fetched from /api/skills (global + per-device); filtered to scope +
  // gating in visibleSkills below.
  private readonly skills = signal<Skill[]>([]);

  // the skills runnable on this service: in scope for its device, and every required
  // `service` param satisfiable on the resolved service row (containerName is always
  // present; composePath/composeProject are null on a standalone container — so up/
  // down hide there, exactly as canCompose() did).
  protected readonly visibleSkills = computed(() => {
    const deviceId = this.deviceId();
    const service = this.service();
    return this.skills().filter(
      (skill) =>
        (skill.deviceId === null || skill.deviceId === deviceId) &&
        skill.parameters.every((parameter) => this.satisfiable(parameter, service))
    );
  });

  constructor() {
    void this.load();
  }

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

  private async load(): Promise<void> {
    try {
      this.skills.set(await this.skillsClient.listForDevice(this.deviceId()));
    } catch {
      // a skill fetch failure must not break the row — it just shows no run controls.
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
