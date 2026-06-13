import { Inject, Injectable, MessageEvent, ServiceUnavailableException } from '@nestjs/common';
import { containerNameSchema, diagnosisSynthesisSchema } from '@opspilot/shared';
import { streamObject } from 'ai';
import { Observable } from 'rxjs';

import { AuditService } from '../audit/audit.service';
import { llmConfig, LlmConfig } from '../config/llm.config';
import { DeviceService } from '../device/device.service';
import { ExecResult, IExecutor } from '../executor/executor.interface';
import { EXECUTOR } from '../executor/executor.token';
import { LlmProviderClientFactory } from '../llm-provider/llm-provider.client-factory';
import { LlmProviderService } from '../llm-provider/llm-provider.service';
import { DockerDaemonDownError, DockerNotFoundError } from '../service/service.errors';
import { ServiceService } from '../service/service.service';
import { diagnoseErrorToStreamEvent, DiagnosisLogsTimeoutError } from './diagnose.errors';
import { RunRecordService } from './run-record.service';

// how often the live stream emits a keep-alive so cloudflare's ~100s idle reap
// never kills a slow run (sse.md / roadmap.md edge note). well under the threshold.
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

  // the s-05 live narration: resolve the service row → fail fast if no provider is
  // active → return the sse observable. the two fail-fast checks run here, BEFORE
  // the observable is returned, so they surface as real http status codes (404/409)
  // and never as an open-then-error stream (critical impl details / sse.md). nest 11
  // resolves a Promise<Observable> from an @Sse handler (router-execution-context),
  // so an awaited pre-flight that throws lands on the global filter as an http error.
  // the ssh logs fetch and the synthesis happen INSIDE the stream — a logs timeout,
  // docker failure, or synthesis fault arrives as an in-stream `error` event, not a
  // pre-stream status, because the stream is already 200 by then.
  async narrate(deviceId: string, serviceId: string, userId: string): Promise<Observable<MessageEvent>> {
    // 404 if the service is absent or belongs to another device; carries containerName.
    const service = await this.serviceService.findOne(deviceId, serviceId);
    // 404 if the device is gone; carries the host-level agentContext persona injected
    // as the model `system` instruction (null/empty → omitted, see buildNarration).
    const device = await this.deviceService.findOne(deviceId);
    // resolve the active provider before opening the stream so a missing provider
    // fails fast with a 409 precondition (LlmProviderNoActiveError). carries the
    // decrypted key — never logged/returned.
    const providerConfig = await this.llmProviderService.getActiveProviderConfig();
    const model = this.clientFactory.create(providerConfig);
    return this.buildNarration(model, deviceId, serviceId, service.containerName, device.agentContext, userId);
  }

  // recent runs for a service row, newest-first and bounded — the replay list read.
  // thin delegate to the crud service (which scopes by device + service).
  recentRuns(deviceId: string, serviceId: string, limit?: number, offset?: number) {
    return this.runRecordService.findRecent(deviceId, serviceId, limit, offset);
  }

  // build the cold sse observable for one run. on subscribe: fetch logs over ssh,
  // stream partials of the fixed synthesis as `delta` frames, accumulate the final
  // object, persist it, then emit a `done` carrying the saved record. a 30s
  // keep-alive `ping` event runs alongside (interval-driven). any mid-stream
  // rejection becomes a single `error` frame, then the stream completes. teardown
  // (client disconnect) aborts the generation and stops the heartbeat.
  private buildNarration(
    model: ReturnType<LlmProviderClientFactory['create']>,
    deviceId: string,
    serviceId: string,
    containerName: string,
    agentContext: null | string,
    userId: string
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      // teardown signal: client disconnect aborts the in-flight generation; the
      // aborted-check before each emit keeps a late resolution from pushing onto a
      // torn-down stream.
      const controller = new AbortController();
      // the heartbeat is a typeless-data event named `ping`, so the browser's
      // EventSource onmessage ignores it (named events don't fire the default
      // handler) — nest's MessageEvent has no sse-comment escape hatch, so a named
      // keep-alive is the rule-compliant analog of a `: ping` comment.
      const heartbeat = setInterval(() => subscriber.next({ data: '', type: 'ping' }), HEARTBEAT_INTERVAL_MS);

      const run = async (): Promise<void> => {
        try {
          const result = await this.fetchLogs(deviceId, containerName);
          if (result.code !== 0) {
            throw this.mapLogsError(deviceId, containerName, result.code, result.stderr);
          }
          // docker logs writes the stream to stderr (non-tty), so merge both — unlike
          // scan() which parses stdout alone. order stdout then stderr; drop empties.
          const logs = [result.stdout, result.stderr]
            .map((stream) => stream.trim())
            .filter((stream) => stream.length > 0)
            .join('\n');

          // the streaming analog of the batch generateText + Output.object: partials
          // fill the fixed schema progressively; `object` resolves to the validated
          // final synthesis (or rejects with NoObjectGeneratedError). bound the run
          // by the same generate timeout, combined with the teardown controller.
          // host-level persona for this device: pass `system` only when the trimmed
          // context is non-empty, so a null row, a cleared field (''), or a
          // whitespace-only entry all behave exactly like today (critical impl details).
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
          // persist BEFORE `done` so the frame carries the real saved record (id +
          // createdAt) the fe prepends to its recent list (critical impl details). the
          // run now carries the authenticated user (s-09 activates the reserved column).
          const saved = this.runRecordService.create({ deviceId, serviceId, synthesis, userId });
          // tier-2 record-on-invocation: emit the linked audit row at the same point the
          // run_record is written, on the base connection (no tx — the sse hot path has
          // no transaction to join). runRecordId points the timeline row at its synthesis.
          this.auditService.record({
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
          // single teardown for the keep-alive — covers success, error, and the
          // abort early-returns alike (each bails out through this finally).
          clearInterval(heartbeat);
        }
      };

      // fire-and-forget: the async pump drives subscriber.next/complete; a throw is
      // caught above and mapped to an error frame, so run() never rejects unhandled.
      void run();

      return () => {
        controller.abort();
        clearInterval(heartbeat);
      };
    });
  }

  // fetch the container's recent logs over the executor with the synology PATH
  // prefix (ssh.md) and a tight per-command bound. IExecutor.execute carries no
  // per-call timeout, so race it against logsTimeoutMs here — distinct from the 30s
  // default SSH_COMMAND_TIMEOUT_MS. the orphaned exec keeps running server-side and
  // its mutex releases when it finishes; we only bound how long diagnose waits.
  private async fetchLogs(deviceId: string, containerName: string): Promise<ExecResult> {
    // re-validate at the shell boundary: containerName is interpolated raw into
    // the command below, so reject anything outside docker's legal name charset
    // (defence-in-depth — the create boundary already constrains it, this guards
    // a row that predates that constraint). throws ZodError → 500 via the filter.
    containerNameSchema.parse(containerName);
    const command =
      'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
      `docker logs ${containerName} --tail ${this.config.logsTailLines}`;
    const exec = this.executor.execute(deviceId, command);
    // swallow a late rejection from the orphan so a post-timeout executor error
    // never surfaces as an unhandled rejection; the race still sees the same throw.
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

  // the synthesis instruction. the four fields mirror diagnosisSynthesisSchema; the
  // model is told the enum, the empty-array convention, and the one-line summary.
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

  // map a non-zero `docker logs` exit to the docker half of the taxonomy, mirroring
  // ServiceService.mapDockerError: daemon-down first (english cli message regardless
  // of host locale), then the missing-binary case (exit 127 is the locale-independent
  // signal). anything else (e.g. "No such container") is a generic upstream 503.
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
