import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  composePathSchema,
  composeProjectSchema,
  containerNameSchema,
  Service,
  ServiceOperation,
  ServiceOperationResult,
  serviceOperationResultSchema,
} from '@opspilot/shared';

import { operationConfig, OperationConfig } from '../config/operation.config';
import { IExecutor } from '../executor/executor.interface';
import { EXECUTOR } from '../executor/executor.token';
import { DockerDaemonDownError, DockerNotFoundError } from '../service/service.errors';
import { ServiceService } from '../service/service.service';

// the synology PATH prefix that resolves docker on a host whose non-interactive ssh
// session omits it (ssh.md); harmless elsewhere. mirrors service.service's SCAN_COMMAND.
const PATH_PREFIX = 'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ';

// the two compose-managed lifecycle ops; the other three are container-scoped.
const COMPOSE_OPERATIONS = new Set<ServiceOperation>(['up', 'down']);

@Injectable()
export class OperationService {
  // explicit @Inject tokens — esbuild/vitest drops design:paramtypes so type-only
  // di resolves to undefined at runtime (lessons.md).
  constructor(
    @Inject(EXECUTOR) private readonly executor: IExecutor,
    @Inject(ServiceService) private readonly serviceService: ServiceService,
    @Inject(operationConfig.KEY) private readonly config: OperationConfig
  ) {}

  // run one fixed lifecycle op against a resolved service row, synchronously: resolve
  // (404 + identity fields) → gate up/down to compose-managed rows + boundary charset
  // re-parse while building the PATH-prefixed command → execute under the dedicated
  // long op timeout → map the exit to an ephemeral result. nothing is persisted (s-09).
  async run(deviceId: string, serviceId: string, operation: ServiceOperation): Promise<ServiceOperationResult> {
    // 404 if the service is absent or belongs to another device; carries the
    // containerName / composePath / composeProject identity fields.
    const service = await this.serviceService.findOne(deviceId, serviceId);
    const command = this.buildCommand(operation, service);
    // the dedicated long bound (default 5 min) so a slow `up -d` image pull outlasts
    // the executor's 30s default — the load-bearing per-call timeout override.
    const result = await this.executor.execute(deviceId, command, this.config.timeoutMs);
    if (result.code === 0) {
      return serviceOperationResultSchema.parse({
        message: this.cleanOutput(result.stdout, result.stderr),
        operation,
        status: 'succeeded',
      });
    }
    // classifyExit throws an infra 503 (daemon-down / docker-not-found) or returns a
    // cleaned message for an op-specific non-zero exit ("no such container", ...) —
    // that returned case is what gives `status: 'failed'` meaning distinct from infra.
    const failure = this.classifyExit(deviceId, result.code, result.stderr);
    return serviceOperationResultSchema.parse({ message: failure.message, operation, status: 'failed' });
  }

  // build the PATH-prefixed shell command for the op, re-parsing every interpolated
  // field through its charset schema at this boundary (defense-in-depth — the fields
  // are populated raw from docker labels / may predate the create-time constraint). a
  // failed parse throws a ZodError → 500 via the global filter before any command is
  // built. up/down gate to compose-managed rows here.
  private buildCommand(operation: ServiceOperation, service: Service): string {
    const containerName = containerNameSchema.parse(service.containerName);
    if (COMPOSE_OPERATIONS.has(operation)) {
      if (service.composePath === null || service.composeProject === null) {
        throw new BadRequestException(`operation ${operation} requires a compose-managed service`);
      }
      const composePath = composePathSchema.parse(service.composePath);
      const composeProject = composeProjectSchema.parse(service.composeProject);
      // pass both -f and -p so the project name is not silently re-derived from the
      // compose file's directory (critical impl detail). `up -d` is detached; `down`
      // removes the containers + the network.
      const composeArgs = operation === 'up' ? 'up -d' : 'down';
      return `${PATH_PREFIX}docker compose -f ${composePath} -p ${composeProject} ${composeArgs}`;
    }
    // container-scoped lifecycle: start | stop | restart <containerName>.
    return `${PATH_PREFIX}docker ${operation} ${containerName}`;
  }

  // interpret a non-zero op exit, mirroring ServiceService.mapDockerError /
  // DiagnoseService.mapLogsError: daemon-down first (docker's cli message is english
  // regardless of host locale), then the missing-binary case (exit 127 is the
  // locale-independent signal). anything else is an op-specific failure — returned as
  // a cleaned message for `status: 'failed'`, not thrown.
  private classifyExit(deviceId: string, code: null | number, stderr: string): { message: string } {
    if (/cannot connect to the docker daemon/i.test(stderr)) {
      throw new DockerDaemonDownError(deviceId);
    }
    if (code === 127) {
      throw new DockerNotFoundError(deviceId);
    }
    return { message: stderr.trim() };
  }

  // merge stdout + stderr into a single confirmation line, dropping empties (docker
  // compose writes its progress to stderr, plain `docker start` to stdout).
  private cleanOutput(stdout: string, stderr: string): string {
    return [stdout, stderr]
      .map((stream) => stream.trim())
      .filter((stream) => stream.length > 0)
      .join('\n');
  }
}
