import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { runRecord, service } from '@api/core/database/schema';
import { IExecutor } from '@api/integrations/executor/executor.interface';
import { EXECUTOR } from '@api/integrations/executor/executor.token';
import { AuditService } from '@api/modules/audit/audit.service';
import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  diagnosisSynthesisSchema,
  ScannedContainer,
  scannedContainerSchema,
  ScanResult,
  scanResultSchema,
  Service,
  ServiceCreateRequest,
  serviceSchema,
  ServiceUpdateRequest,
  ServiceWithStatus,
  serviceWithStatusSchema,
} from '@opspilot/shared';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { DockerDaemonDownError, DockerNotFoundError } from './service.errors';

type ServiceRow = typeof service.$inferSelect;

// explicit-field ndjson (not whole-struct json, which forces the per-container
// layer-size walk — lessons.md); --no-trunc keeps full names/labels; PATH prefix
// resolves docker on synology's non-interactive ssh session (ssh.md), harmless elsewhere.
const SCAN_COMMAND =
  'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
  'docker ps --no-trunc --format ' +
  `'{"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}},"Labels":{{json .Labels}}}'`;
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';

@Injectable()
export class ServiceService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection,
    @Inject(EXECUTOR) private readonly executor: IExecutor,
    @Inject(AuditService) private readonly auditService: AuditService
  ) {}

  // run docker ps over ssh for live host state; executor already maps connect/auth/timeout,
  // here we only interpret the docker-specific failures.
  async scan(deviceId: string, userId: string): Promise<ScanResult> {
    const result = await this.executor.execute(deviceId, SCAN_COMMAND);
    if (result.code !== 0) {
      throw this.mapDockerError(deviceId, result.code, result.stderr);
    }
    const containers = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => this.parseContainer(line));
    const scanResult = scanResultSchema.parse({ containers });
    // tier-2 record-on-invocation: no tx (scan persists nothing); a failed scan leaves
    // no row, a failed audit insert is logged not thrown — the scan already succeeded.
    this.auditService.recordOnInvocation({
      action: 'service.scan',
      metadata: { found: scanResult.containers.length },
      targetId: deviceId,
      targetType: 'device',
      userId,
    });
    return scanResult;
  }

  async findAll(deviceId: string): Promise<Service[]> {
    const rows = this.db.select().from(service).where(eq(service.deviceId, deviceId)).all();
    return rows.map((row) => this.toContract(row));
  }

  // fleet read: every service joined to the status of its newest run. the device/service
  // domain carries no userId (single-tenant), so this returns the whole fleet — consistent
  // with findAll(deviceId) and GET /devices, no user filter. sqlite has no DISTINCT ON, so we
  // scan run_records newest-first and keep the first synthesis seen per serviceId (= its latest
  // run); zero-run services fall through to null. small dataset (perf notes) — no per-row fan-out.
  async findAllWithStatus(): Promise<ServiceWithStatus[]> {
    const services = this.db.select().from(service).all();
    const latestSynthesis = new Map<string, string>();
    const runs = this.db
      .select({ serviceId: runRecord.serviceId, synthesis: runRecord.synthesis })
      .from(runRecord)
      .orderBy(desc(runRecord.createdAt))
      .all();
    for (const run of runs) {
      if (!latestSynthesis.has(run.serviceId)) {
        latestSynthesis.set(run.serviceId, run.synthesis);
      }
    }
    return services.map((row) => this.toContractWithStatus(row, latestSynthesis.get(row.id) ?? null));
  }

  // single managed service scoped to its device (404 if absent or cross-device);
  // s-04 diagnose composes this to turn a serviceId into its containerName.
  async findOne(deviceId: string, id: string): Promise<Service> {
    return this.toContract(this.requireRow(deviceId, id));
  }

  async create(input: ServiceCreateRequest, userId: string): Promise<Service> {
    try {
      // insert + audit row in one transaction; the unique-constraint rejection surfaces as a 409 below.
      const row = this.db.transaction((tx) => {
        const inserted = tx
          .insert(service)
          .values({
            composePath: input.composePath ?? null,
            composeProject: input.composeProject ?? null,
            containerName: input.containerName,
            deviceId: input.deviceId,
            id: randomUUID(),
            name: input.name,
          })
          .returning()
          .get();
        this.auditService.record(
          {
            action: 'service.create',
            metadata: { containerName: inserted.containerName, deviceId: inserted.deviceId, name: inserted.name },
            targetId: inserted.id,
            targetType: 'service',
            userId,
          },
          tx
        );
        return inserted;
      });
      return this.toContract(row);
    } catch (error) {
      // the (deviceId, containerName) unique index rejects a duplicate — surface a 409, not an opaque 500.
      if (error instanceof Error && /unique constraint failed/i.test(error.message)) {
        throw new ConflictException(`container ${input.containerName} is already managed on device ${input.deviceId}`);
      }
      throw error;
    }
  }

  // only the display name is editable; identity fields are scan-derived (immutable).
  async update(deviceId: string, id: string, input: ServiceUpdateRequest, userId: string): Promise<Service> {
    this.requireRow(deviceId, id);
    const row = this.db.transaction((tx) => {
      const updated = tx.update(service).set({ name: input.name }).where(eq(service.id, id)).returning().get();
      this.auditService.record(
        { action: 'service.update', metadata: { name: updated.name }, targetId: id, targetType: 'service', userId },
        tx
      );
      return updated;
    });
    return this.toContract(row);
  }

  async remove(deviceId: string, id: string, userId: string): Promise<void> {
    const existing = this.requireRow(deviceId, id);
    this.db.transaction((tx) => {
      tx.delete(service).where(eq(service.id, id)).run();
      this.auditService.record(
        {
          action: 'service.delete',
          metadata: { containerName: existing.containerName },
          targetId: id,
          targetType: 'service',
          userId,
        },
        tx
      );
    });
  }

  // map non-zero exit + stderr to the docker taxonomy: daemon-down first (cli message is
  // english regardless of host locale), then missing-binary. exit 127 is the locale-independent
  // "command not found" signal; the localized stderr regex is only a secondary fallback.
  private mapDockerError(deviceId: string, code: null | number, stderr: string): ServiceUnavailableException {
    if (/cannot connect to the docker daemon/i.test(stderr)) {
      return new DockerDaemonDownError(deviceId);
    }
    if (code === 127 || /not found/i.test(stderr)) {
      return new DockerNotFoundError(deviceId);
    }
    return new ServiceUnavailableException(`docker ps failed on device ${deviceId}: ${stderr.trim()}`);
  }

  private parseContainer(line: string): ScannedContainer {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const labels = this.parseLabels(typeof raw.Labels === 'string' ? raw.Labels : '');
    return scannedContainerSchema.parse({
      composePath: labels.get(COMPOSE_CONFIG_FILES_LABEL) ?? null,
      composeProject: labels.get(COMPOSE_PROJECT_LABEL) ?? null,
      containerName: raw.Names,
      image: raw.Image,
      state: raw.State,
      status: raw.Status,
    });
  }

  // labels are a flat `key=value,key=value` string; split on the first `=` so values with
  // `=` survive (comma-bearing paths are best-effort — single-file compose is the homelab norm).
  private parseLabels(labels: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const pair of labels.split(',')) {
      if (!pair) {
        continue;
      }
      const separator = pair.indexOf('=');
      if (separator === -1) {
        continue;
      }
      map.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return map;
  }

  private requireRow(deviceId: string, id: string): ServiceRow {
    const row = this.db
      .select()
      .from(service)
      .where(and(eq(service.id, id), eq(service.deviceId, deviceId)))
      .get();
    if (!row) {
      throw new NotFoundException(`service ${id} not found`);
    }
    return row;
  }

  // extract the wire status from a run_record.synthesis json blob; a null synthesis (no runs)
  // or a malformed historical row both yield null — the web renders that as grey 'unknown',
  // never green. mirrors overview.service's defensive parse: one bad row must not 500 the fleet.
  private latestStatus(synthesisJson: null | string): ServiceWithStatus['status'] {
    if (synthesisJson === null) {
      return null;
    }
    try {
      return diagnosisSynthesisSchema.parse(JSON.parse(synthesisJson)).status;
    } catch {
      return null;
    }
  }

  // project safe fields; iso-normalize timestamps; never spread
  private toContract(row: ServiceRow): Service {
    return serviceSchema.parse({
      composePath: row.composePath,
      composeProject: row.composeProject,
      containerName: row.containerName,
      createdAt: row.createdAt,
      deviceId: row.deviceId,
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt,
    });
  }

  // project safe fields + the derived latest-run status; iso-normalize timestamps; never spread.
  private toContractWithStatus(row: ServiceRow, synthesisJson: null | string): ServiceWithStatus {
    return serviceWithStatusSchema.parse({
      composePath: row.composePath,
      composeProject: row.composeProject,
      containerName: row.containerName,
      createdAt: row.createdAt,
      deviceId: row.deviceId,
      id: row.id,
      name: row.name,
      status: this.latestStatus(synthesisJson),
      updatedAt: row.updatedAt,
    });
  }
}
