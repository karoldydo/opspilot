import { skillConfig, SkillConfig } from '@api/config/skill.config';
import { IExecutor } from '@api/integrations/executor/executor.interface';
import { EXECUTOR } from '@api/integrations/executor/executor.token';
import { AuditService } from '@api/modules/audit/audit.service';
import { DockerDaemonDownError, DockerNotFoundError } from '@api/modules/service/service.errors';
import { ServiceService } from '@api/modules/service/service.service';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Service,
  Skill,
  SkillParameter,
  skillParameterValueSchema,
  SkillRunRequest,
  SkillRunResult,
  skillRunResultSchema,
} from '@opspilot/shared';

import { SkillService } from './skill.service';

// synology PATH prefix so docker resolves on a non-interactive ssh session (ssh.md), harmless
// elsewhere; prepended by the renderer at run time, never stored in a skill's command template.
const PATH_PREFIX = 'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ';

// matches one {{name}} placeholder — same grammar skillCommandTemplateSchema validates against.
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

// the service-derived fields a `service`-source parameter binds to, read off the resolved row.
type ServiceField = 'composePath' | 'composeProject' | 'containerName';

@Injectable()
export class SkillRunService {
  // explicit @Inject tokens — esbuild/vitest drops design:paramtypes so type-only di
  // resolves to undefined at runtime (lessons.md).
  constructor(
    @Inject(EXECUTOR) private readonly executor: IExecutor,
    @Inject(ServiceService) private readonly serviceService: ServiceService,
    @Inject(SkillService) private readonly skillService: SkillService,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(skillConfig.KEY) private readonly config: SkillConfig
  ) {}

  // run one skill against a resolved service row, synchronously: resolve service (404) →
  // assert skill in scope for the device (404 guardrail) → render the template (re-parsing
  // every value at the shell boundary) → execute under the skill/config timeout → map the
  // exit → tier-2 audit on invocation (s-09).
  async run(
    deviceId: string,
    serviceId: string,
    skillId: string,
    inputs: SkillRunRequest['inputs'],
    userId: string
  ): Promise<SkillRunResult> {
    // 404 if the service is absent or cross-device; carries the identity fields.
    const service = await this.serviceService.findOne(deviceId, serviceId);
    const skill = await this.requireInScope(deviceId, skillId);
    const command = this.renderCommand(skill, service, inputs);
    // a slow `up -d` pull can outlast the 30s default, so override with the skill/config timeout.
    const result = await this.executor.execute(deviceId, command, skill.timeoutMs ?? this.config.timeoutMs);
    // classifyExit throws an infra 503 (daemon-down / not-found) or returns a cleaned message
    // for a skill-specific exit — the `status: 'failed'` case. an infra throw leaves no audit row.
    const outcome =
      result.code === 0
        ? skillRunResultSchema.parse({ message: this.cleanOutput(result.stdout, result.stderr), status: 'succeeded' })
        : skillRunResultSchema.parse({
            message: this.classifyExit(skill, deviceId, result.code, result.stdout, result.stderr).message,
            status: 'failed',
          });
    // tier-2 record-on-invocation: no tx, secret-free metadata (skill name + status); best-effort,
    // a failed insert is logged not thrown since the run already succeeded.
    this.auditService.recordOnInvocation({
      action: 'skill.run',
      metadata: { outcome: outcome.status, skillName: skill.name },
      targetId: serviceId,
      targetType: 'service',
      userId,
    });
    return outcome;
  }

  // scope guardrail: findForDevice returns the device's global + own skills, so anything
  // outside it (forged or other-device id) is indistinguishable from absent → a single 404.
  private async requireInScope(deviceId: string, skillId: string): Promise<Skill> {
    const inScope = await this.skillService.findForDevice(deviceId);
    const found = inScope.find((candidate) => candidate.id === skillId);
    if (!found) {
      throw new NotFoundException(`skill ${skillId} not found`);
    }
    return found;
  }

  // build the PATH-prefixed command: re-parse each value through skillParameterValueSchema
  // at this boundary (defense-in-depth — service fields may predate the create constraint),
  // then substitute for its {{name}}. bad charset → ZodError; unfilled placeholder → 400.
  private renderCommand(skill: Skill, service: Service, inputs: SkillRunRequest['inputs']): string {
    const values = new Map<string, string>();
    for (const parameter of skill.parameters) {
      const raw =
        parameter.source === 'service'
          ? this.resolveServiceValue(skill, parameter, service)
          : this.resolveInputValue(skill, parameter, inputs);
      // an optional param with no value is left out; the substitution rejects an unfilled placeholder.
      if (raw === undefined) {
        continue;
      }
      values.set(parameter.name, skillParameterValueSchema.parse(raw));
    }
    const rendered = skill.commandTemplate.replace(PLACEHOLDER, (_match, name: string) => {
      const value = values.get(name);
      if (value === undefined) {
        throw new BadRequestException(`skill ${skill.name} is missing a value for parameter ${name}`);
      }
      return value;
    });
    return `${PATH_PREFIX}${rendered}`;
  }

  // a `service` param is read off the row; a null compose field surfaces the compose-managed
  // 400 (up/down gating), and containerName is never null so that branch only fires for compose.
  private resolveServiceValue(skill: Skill, parameter: SkillParameter, service: Service): string | undefined {
    const value = service[parameter.name as ServiceField];
    if (value === null) {
      if (parameter.required) {
        throw new BadRequestException(`skill ${skill.name} requires a compose-managed service`);
      }
      return undefined;
    }
    return value;
  }

  // an `input` param is read from the request body; a missing required one is a 400 (charset
  // checked at the controller and re-parsed in renderCommand).
  private resolveInputValue(
    skill: Skill,
    parameter: SkillParameter,
    inputs: SkillRunRequest['inputs']
  ): string | undefined {
    const value = inputs[parameter.name];
    if (value === undefined) {
      if (parameter.required) {
        throw new BadRequestException(`skill ${skill.name} requires input parameter ${parameter.name}`);
      }
      return undefined;
    }
    return value;
  }

  // interpret a non-zero exit: daemon-down first (cli message is english regardless of locale),
  // then exit 127; anything else is a skill-specific failure → cleaned message for `status: 'failed'`.
  private classifyExit(
    skill: Skill,
    deviceId: string,
    code: null | number,
    stdout: string,
    stderr: string
  ): { message: string } {
    if (/cannot connect to the docker daemon/i.test(stderr)) {
      throw new DockerDaemonDownError(deviceId);
    }
    if (code === 127) {
      throw new DockerNotFoundError(deviceId);
    }
    return { message: this.cleanOutput(stdout, stderr) || `skill ${skill.name} failed` };
  }

  // merge stdout + stderr into one line, dropping empties (compose writes to stderr, `docker start` to stdout).
  private cleanOutput(stdout: string, stderr: string): string {
    return [stdout, stderr]
      .map((stream) => stream.trim())
      .filter((stream) => stream.length > 0)
      .join('\n');
  }
}
