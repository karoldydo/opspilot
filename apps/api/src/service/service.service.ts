import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  ScannedContainer,
  scannedContainerSchema,
  ScanResult,
  scanResultSchema,
  Service,
  ServiceCreateRequest,
  serviceSchema,
  ServiceUpdateRequest,
} from '@opspilot/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { service } from '../database/schema';
import { IExecutor } from '../executor/executor.interface';
import { EXECUTOR } from '../executor/executor.token';
import { DockerDaemonDownError, DockerNotFoundError } from './service.errors';

type ServiceRow = typeof service.$inferSelect;

// ndjson so spaces in names don't break column parsing; --no-trunc keeps full
// names/labels. compose project/path are read out of the container labels. the
// PATH prefix resolves docker on hosts whose non-interactive ssh session omits it
// (synology keeps docker off the default PATH — ssh.md); harmless elsewhere.
const SCAN_COMMAND =
  'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
  "docker ps --format '{{json .}}' --no-trunc";
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';

@Injectable()
export class ServiceService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection,
    @Inject(EXECUTOR) private readonly executor: IExecutor
  ) {}

  // ephemeral: run docker ps over ssh and parse the live host state for the
  // curation ui. connect/auth/timeout already arrive as executor domain errors and
  // propagate; here we only interpret the docker-specific failures.
  async scan(deviceId: string): Promise<ScanResult> {
    const result = await this.executor.execute(deviceId, SCAN_COMMAND);
    if (result.code !== 0) {
      throw this.mapDockerError(deviceId, result.code, result.stderr);
    }
    const containers = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => this.parseContainer(line));
    return scanResultSchema.parse({ containers });
  }

  async findAll(deviceId: string): Promise<Service[]> {
    const rows = this.db.select().from(service).where(eq(service.deviceId, deviceId)).all();
    return rows.map((row) => this.toContract(row));
  }

  async create(input: ServiceCreateRequest): Promise<Service> {
    try {
      const row = this.db
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
      return this.toContract(row);
    } catch (error) {
      // the (deviceId, containerName) unique index rejects a duplicate container —
      // surface it as a legible 409 rather than an opaque 500.
      if (error instanceof Error && /unique constraint failed/i.test(error.message)) {
        throw new ConflictException(`container ${input.containerName} is already managed on device ${input.deviceId}`);
      }
      throw error;
    }
  }

  // only the display name is editable; identity fields are scan-derived (immutable).
  async update(deviceId: string, id: string, input: ServiceUpdateRequest): Promise<Service> {
    this.requireRow(deviceId, id);
    const row = this.db.update(service).set({ name: input.name }).where(eq(service.id, id)).returning().get();
    return this.toContract(row);
  }

  // delete scoped to the device (the nested route's :deviceId is the source of
  // truth); a service that doesn't belong to the device yields a 404.
  async remove(deviceId: string, id: string): Promise<void> {
    this.requireRow(deviceId, id);
    this.db.delete(service).where(eq(service.id, id)).run();
  }

  // map docker's non-zero exit + stderr to the docker half of the taxonomy. check
  // daemon-down first (docker's own cli message is english regardless of host
  // locale), then the missing-binary case. exit code 127 is the shell's
  // locale-independent "command not found" — the stderr text is localized (e.g.
  // polish "nie odnaleziono polecenia"), so the code is the robust signal; keep the
  // english regex as a secondary fallback.
  private mapDockerError(deviceId: string, code: null | number, stderr: string): ServiceUnavailableException {
    if (/cannot connect to the docker daemon/i.test(stderr)) {
      return new DockerDaemonDownError(deviceId);
    }
    if (code === 127 || /not found/i.test(stderr)) {
      return new DockerNotFoundError(deviceId);
    }
    return new ServiceUnavailableException(`docker ps failed on device ${deviceId}: ${stderr.trim()}`);
  }

  // parse one `docker ps --format '{{json .}}'` ndjson line into the ephemeral
  // scanned-container contract, deriving compose project/path from the labels.
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

  // docker emits labels as a flat `key=value,key=value` string. split on the first
  // `=` per pair so values containing `=` survive; best-effort for the rare case of
  // a comma-bearing config_files path (single-file compose is the homelab norm).
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

  // read the row scoped to its device or fail with an entity-naming 404 — a
  // cross-device id yields a 404, never a cross-device mutation (nestjs.md).
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

  // project safe fields only (never spread the row) and validate through the shared
  // contract, which normalizes the timestamp_ms dates to iso strings.
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
}
