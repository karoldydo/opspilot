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

import { skillConfig, SkillConfig } from '../config/skill.config';
import { IExecutor } from '../executor/executor.interface';
import { EXECUTOR } from '../executor/executor.token';
import { DockerDaemonDownError, DockerNotFoundError } from '../service/service.errors';
import { ServiceService } from '../service/service.service';
import { SkillService } from './skill.service';

// the synology PATH prefix that resolves docker on a host whose non-interactive ssh
// session omits it (ssh.md); harmless elsewhere. mirrors service.service's SCAN_COMMAND
// and the retired operation.service's prefix — prepended by the renderer at run time,
// never stored in a skill's command template.
const PATH_PREFIX = 'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ';

// matches one {{name}} placeholder (whitespace tolerant), capturing the identifier —
// the same grammar skillCommandTemplateSchema validates the template against.
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

// the known service-derived fields a `service`-source parameter binds to (the set
// skillParameterSchema constrains the name to). read off the resolved row at run time.
type ServiceField = 'composePath' | 'composeProject' | 'containerName';

@Injectable()
export class SkillRunService {
  // explicit @Inject tokens — esbuild/vitest drops design:paramtypes so type-only di
  // resolves to undefined at runtime (lessons.md).
  constructor(
    @Inject(EXECUTOR) private readonly executor: IExecutor,
    @Inject(ServiceService) private readonly serviceService: ServiceService,
    @Inject(SkillService) private readonly skillService: SkillService,
    @Inject(skillConfig.KEY) private readonly config: SkillConfig
  ) {}

  // run one skill against a resolved service row, synchronously — the generalization of
  // the retired operation.service.run. (1) resolve the service (404 + identity fields);
  // (2) load the skill and assert it is in scope for this device (global or that device)
  // else 404 — the runtime guardrail that replaced the op enum; (3) fill `service` params
  // from the resolved row and `input` params from the request, re-parsing every value at
  // the shell boundary while rendering the template; (4) prepend the PATH prefix; (5)
  // execute under the skill row's timeout or the config default; (6) map the exit to an
  // ephemeral result. nothing is persisted (s-09).
  async run(
    deviceId: string,
    serviceId: string,
    skillId: string,
    inputs: SkillRunRequest['inputs']
  ): Promise<SkillRunResult> {
    // 404 if the service is absent or belongs to another device; carries the
    // containerName / composePath / composeProject identity fields.
    const service = await this.serviceService.findOne(deviceId, serviceId);
    const skill = await this.requireInScope(deviceId, skillId);
    const command = this.renderCommand(skill, service, inputs);
    // a slow `up -d` image pull can outlast the executor's 30s default, so the run
    // overrides it with the skill's own timeout or the config fallback.
    const result = await this.executor.execute(deviceId, command, skill.timeoutMs ?? this.config.timeoutMs);
    if (result.code === 0) {
      return skillRunResultSchema.parse({
        message: this.cleanOutput(result.stdout, result.stderr),
        status: 'succeeded',
      });
    }
    // classifyExit throws an infra 503 (daemon-down / docker-not-found) or returns a
    // cleaned message for a skill-specific non-zero exit — that returned case is what
    // gives `status: 'failed'` meaning distinct from infra.
    const failure = this.classifyExit(skill, deviceId, result.code, result.stdout, result.stderr);
    return skillRunResultSchema.parse({ message: failure.message, status: 'failed' });
  }

  // the scope guardrail: a device may run a global skill (deviceId null) or one of its
  // own. findForDevice returns exactly that set, so a skill outside it — a forged id or
  // one belonging to another device — is indistinguishable from absent and yields a
  // single 404. this is the runtime check that replaced the compile-time op enum.
  private async requireInScope(deviceId: string, skillId: string): Promise<Skill> {
    const inScope = await this.skillService.findForDevice(deviceId);
    const found = inScope.find((candidate) => candidate.id === skillId);
    if (!found) {
      throw new NotFoundException(`skill ${skillId} not found`);
    }
    return found;
  }

  // build the PATH-prefixed command: fill each declared parameter, re-parse its value
  // through skillParameterValueSchema at this boundary (defense-in-depth — service
  // fields may predate the create-time constraint; inputs are re-checked after the
  // controller pipe), then substitute it for its {{name}} placeholder. a failed charset
  // parse throws a ZodError before the command is assembled; an unfilled placeholder
  // throws a 400.
  private renderCommand(skill: Skill, service: Service, inputs: SkillRunRequest['inputs']): string {
    const values = new Map<string, string>();
    for (const parameter of skill.parameters) {
      const raw =
        parameter.source === 'service'
          ? this.resolveServiceValue(skill, parameter, service)
          : this.resolveInputValue(skill, parameter, inputs);
      // an optional param with no value is left out; the substitution below rejects any
      // resulting unfilled placeholder.
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

  // a `service` param is read off the resolved row; a null compose field surfaces the
  // existing compose-managed 400, preserving the up/down gating without special-casing.
  // containerName is never null, so that branch only fires for compose fields.
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

  // an `input` param is read from the request body; a missing required input is a 400.
  // the value is charset-checked at the controller (skillRunRequestSchema) and re-parsed
  // again in renderCommand.
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

  // interpret a non-zero exit, carried over verbatim from operation.service (s-06
  // behavior preserved): daemon-down first (docker's cli message is english regardless
  // of host locale), then the missing-binary case (exit 127). anything else is a
  // skill-specific failure — returned as a cleaned message for `status: 'failed'`.
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

  // merge stdout + stderr into a single confirmation line, dropping empties (docker
  // compose writes progress to stderr, plain `docker start` to stdout).
  private cleanOutput(stdout: string, stderr: string): string {
    return [stdout, stderr]
      .map((stream) => stream.trim())
      .filter((stream) => stream.length > 0)
      .join('\n');
  }
}
