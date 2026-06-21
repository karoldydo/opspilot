import { llmConfig, LlmConfig } from '@api/config/llm.config';
import { ExecResult, IExecutor } from '@api/integrations/executor/executor.interface';
import { EXECUTOR } from '@api/integrations/executor/executor.token';
import { AuditService } from '@api/modules/audit/audit.service';
import { DeviceService } from '@api/modules/device/device.service';
import { LlmProviderClientFactory } from '@api/modules/llm-provider/llm-provider.client-factory';
import { LlmProviderService } from '@api/modules/llm-provider/llm-provider.service';
import { DockerDaemonDownError, DockerNotFoundError } from '@api/modules/service/service.errors';
import { ServiceService } from '@api/modules/service/service.service';
import { Inject, Injectable, MessageEvent, ServiceUnavailableException } from '@nestjs/common';
import { containerNameSchema, diagnosisSynthesisSchema } from '@opspilot/shared';
import { streamObject } from 'ai';
import { Observable } from 'rxjs';

import { diagnoseErrorToStreamEvent, DiagnosisLogsTimeoutError } from './diagnose.errors';
import { RunRecordService } from './run-record.service';

// keep-alive interval so cloudflare's ~100s idle reap never kills a slow run (sse.md).
const HEARTBEAT_INTERVAL_MS = 30_000;

@Injectable()
export class DiagnoseService {
  // explicit @Inject tokens — esbuild/vitest drops design:paramtypes so type-only
  // di resolves to undefined at runtime (lessons.md).
  constructor(
    @Inject(EXECUTOR) private readonly executor: IExecutor,
    @Inject(ServiceService) private readonly serviceService: ServiceService,
    @Inject(DeviceService) private readonly deviceService: DeviceService,
    @Inject(LlmProviderService) private readonly llmProviderService: LlmProviderService,
    @Inject(LlmProviderClientFactory) private readonly clientFactory: LlmProviderClientFactory,
    @Inject(RunRecordService) private readonly runRecordService: RunRecordService,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(llmConfig.KEY) private readonly config: LlmConfig
  ) {}

  // s-05 live narration. the pre-flight checks run BEFORE the observable is returned, so
  // they surface as real http status (404/409), not an open-then-error stream: nest 11
  // awaits the Promise<Observable> from an @Sse handler, so a throwing pre-flight lands on
  // the global filter. logs fetch + synthesis happen INSIDE the stream — their faults
  // arrive as an in-stream `error` frame, since the stream is already 200 by then.
  async narrate(deviceId: string, serviceId: string, userId: string): Promise<Observable<MessageEvent>> {
    // 404 if the service is absent or belongs to another device; carries containerName.
    const service = await this.serviceService.findOne(deviceId, serviceId);
    // 404 if the device is gone; carries the agentContext persona used as model `system`.
    const device = await this.deviceService.findOne(deviceId);
    // resolve the active provider before the stream opens so a missing one 409s; carries
    // the decrypted key — never logged/returned.
    const providerConfig = await this.llmProviderService.getActiveProviderConfig();
    const model = this.clientFactory.create(providerConfig);
    return this.buildNarration(model, deviceId, serviceId, service.containerName, device.agentContext, userId);
  }

  recentRuns(deviceId: string, serviceId: string, limit?: number, offset?: number) {
    return this.runRecordService.findRecent(deviceId, serviceId, limit, offset);
  }

  // cold sse observable for one run: fetch logs → stream `delta` partials → persist →
  // `done`. a `ping` keep-alive runs alongside; any mid-stream rejection becomes one
  // `error` frame; teardown aborts the generation and stops the heartbeat.
  private buildNarration(
    model: ReturnType<LlmProviderClientFactory['create']>,
    deviceId: string,
    serviceId: string,
    containerName: string,
    agentContext: null | string,
    userId: string
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      // teardown: client disconnect aborts generation; the aborted-check before each emit
      // keeps a late resolution off a torn-down stream.
      const controller = new AbortController();
      // named `ping` event so EventSource.onmessage ignores it (named events skip the
      // default handler); nest's MessageEvent has no `: ping` comment escape hatch.
      const heartbeat = setInterval(() => subscriber.next({ data: '', type: 'ping' }), HEARTBEAT_INTERVAL_MS);

      const run = async (): Promise<void> => {
        try {
          const result = await this.fetchLogs(deviceId, containerName);
          if (result.code !== 0) {
            throw this.mapLogsError(deviceId, containerName, result.code, result.stderr);
          }
          // docker logs writes to stderr (non-tty), so merge both — unlike scan() which
          // parses stdout alone. order stdout then stderr; drop empties.
          const logs = [result.stdout, result.stderr]
            .map((stream) => stream.trim())
            .filter((stream) => stream.length > 0)
            .join('\n');

          // streaming synthesis: partials fill the fixed schema, `object` resolves to the
          // validated final (or rejects NoObjectGeneratedError); bound by the generate
          // timeout + teardown controller. pass `system` only when the trimmed persona is
          // non-empty, so null / '' / whitespace-only all behave identically.
          const system = agentContext?.trim();
          const { object, partialObjectStream } = streamObject({
            abortSignal: AbortSignal.any([AbortSignal.timeout(this.config.generateTimeoutMs), controller.signal]),
            model,
            prompt: this.buildPrompt(containerName, logs),
            schema: diagnosisSynthesisSchema,
            ...(system ? { system } : {}),
          });

          for await (const partial of partialObjectStream) {
            if (controller.signal.aborted) {
              return;
            }
            subscriber.next({ data: { partial, type: 'delta' } });
          }
          const synthesis = await object;
          if (controller.signal.aborted) {
            return;
          }
          // persist BEFORE `done` so the frame carries the real saved record (id + createdAt);
          // the run now carries the authenticated user (s-09).
          const saved = this.runRecordService.create({ deviceId, serviceId, synthesis, userId });
          // tier-2 record-on-invocation: no tx (sse hot path has none); runRecordId links the
          // timeline row to its synthesis. best-effort — a failed insert is logged, not thrown.
          this.auditService.recordOnInvocation({
            action: 'diagnose.run',
            runRecordId: saved.id,
            targetId: serviceId,
            targetType: 'service',
            userId,
          });
          subscriber.next({ data: { run: saved, type: 'done' } });
          subscriber.complete();
        } catch (error) {
          // a teardown-driven abort is not a failure to report — the stream is gone.
          if (controller.signal.aborted) {
            return;
          }
          const { code, message } = diagnoseErrorToStreamEvent(error);
          subscriber.next({ data: { code, message, type: 'error' } });
          subscriber.complete();
        } finally {
          // single teardown for the keep-alive across success, error, and the abort early-returns.
          clearInterval(heartbeat);
        }
      };

      void run();

      return () => {
        controller.abort();
        clearInterval(heartbeat);
      };
    });
  }

  // fetch recent logs over the executor with the synology PATH prefix (ssh.md). race it
  // against logsTimeoutMs here — distinct from the 30s default SSH_COMMAND_TIMEOUT_MS; the
  // orphaned exec keeps running server-side, we only bound how long diagnose waits.
  private async fetchLogs(deviceId: string, containerName: string): Promise<ExecResult> {
    // re-validate at the shell boundary: containerName is interpolated raw, so reject
    // anything outside docker's name charset (defense-in-depth for rows predating the
    // create constraint). throws ZodError → 500 via the filter.
    containerNameSchema.parse(containerName);
    const command =
      'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
      `docker logs ${containerName} --tail ${this.config.logsTailLines}`;
    const exec = this.executor.execute(deviceId, command);
    // swallow the orphan's late rejection so a post-timeout error isn't unhandled; the race
    // still sees the same throw.
    exec.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new DiagnosisLogsTimeoutError(containerName, this.config.logsTimeoutMs)),
        this.config.logsTimeoutMs
      );
    });
    try {
      return await Promise.race([exec, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private buildPrompt(containerName: string, logs: string): string {
    return [
      `You are an ops diagnostician. Analyze the recent logs of the docker container "${containerName}" and produce a structured diagnosis.`,
      '',
      'Fields:',
      "- status: 'healthy' if the logs show normal operation, 'degraded' if there are recoverable errors or warnings, 'down' if the service is failing or crashing.",
      '- problems: concrete issues found in the logs. Empty array if none.',
      '- suggestions: actionable remediation steps. Empty array if none.',
      '- summary: a single one-line plain-language summary of the service state.',
      '',
      `Logs (most recent ${this.config.logsTailLines} lines):`,
      logs.length > 0 ? logs : '(no log output)',
    ].join('\n');
  }

  // map a non-zero `docker logs` exit to the docker taxonomy (mirrors mapDockerError):
  // daemon-down first (english cli message), then exit 127; anything else is a 503.
  private mapLogsError(
    deviceId: string,
    containerName: string,
    code: null | number,
    stderr: string
  ): ServiceUnavailableException {
    if (/cannot connect to the docker daemon/i.test(stderr)) {
      return new DockerDaemonDownError(deviceId);
    }
    if (code === 127) {
      return new DockerNotFoundError(deviceId);
    }
    return new ServiceUnavailableException(
      `docker logs failed for ${containerName} on device ${deviceId}: ${stderr.trim()}`
    );
  }
}
