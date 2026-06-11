import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { containerNameSchema, DiagnosisSynthesis, diagnosisSynthesisSchema } from '@opspilot/shared';
import { generateText, NoObjectGeneratedError, Output } from 'ai';

import { llmConfig, LlmConfig } from '../config/llm.config';
import { ExecResult, IExecutor } from '../executor/executor.interface';
import { EXECUTOR } from '../executor/executor.token';
import { LlmProviderClientFactory } from '../llm-provider/llm-provider.client-factory';
import { LlmProviderService } from '../llm-provider/llm-provider.service';
import { DockerDaemonDownError, DockerNotFoundError } from '../service/service.errors';
import { ServiceService } from '../service/service.service';
import { DiagnosisLogsTimeoutError, DiagnosisSynthesisError, DiagnosisTimeoutError } from './diagnose.errors';

@Injectable()
export class DiagnoseService {
  // explicit @Inject tokens — esbuild/vitest drops design:paramtypes so type-only
  // di resolves to undefined at runtime (lessons.md).
  constructor(
    @Inject(EXECUTOR) private readonly executor: IExecutor,
    @Inject(ServiceService) private readonly serviceService: ServiceService,
    @Inject(LlmProviderService) private readonly llmProviderService: LlmProviderService,
    @Inject(LlmProviderClientFactory) private readonly clientFactory: LlmProviderClientFactory,
    @Inject(llmConfig.KEY) private readonly config: LlmConfig
  ) {}

  // the s-04 orchestration: resolve the service row → fail fast if no provider is
  // active → fetch container logs over ssh → synthesize a fixed 4-field diagnosis.
  // the response is ephemeral (no run-record persistence — that is s-09).
  async diagnose(deviceId: string, serviceId: string): Promise<DiagnosisSynthesis> {
    // 404 if the service is absent or belongs to another device; carries containerName.
    const service = await this.serviceService.findOne(deviceId, serviceId);
    // resolve the active provider before the ssh round-trip so a missing provider
    // fails fast with a 409 precondition (LlmProviderNoActiveError) instead of after
    // paying the logs-fetch cost. carries the decrypted key — never logged/returned.
    const providerConfig = await this.llmProviderService.getActiveProviderConfig();

    const result = await this.fetchLogs(deviceId, service.containerName);
    if (result.code !== 0) {
      throw this.mapLogsError(deviceId, service.containerName, result.code, result.stderr);
    }
    // docker logs writes the stream to stderr (non-tty), so merge both — unlike
    // scan() which parses stdout alone. order stdout then stderr; drop empties.
    const logs = [result.stdout, result.stderr]
      .map((stream) => stream.trim())
      .filter((stream) => stream.length > 0)
      .join('\n');

    const model = this.clientFactory.create(providerConfig);
    return this.synthesize(model, service.containerName, logs);
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

  // synthesize the fixed 4-field diagnosis. Output.object forces the model to emit
  // the shared schema; the Phase 2 factory turned structured-output enforcement on,
  // so a provider that ignores json_schema throws NoObjectGeneratedError rather than
  // returning a silently-malformed 200 — caught and mapped to a first-class 5xx.
  private async synthesize(
    model: ReturnType<LlmProviderClientFactory['create']>,
    containerName: string,
    logs: string
  ): Promise<DiagnosisSynthesis> {
    try {
      const { output } = await generateText({
        abortSignal: AbortSignal.timeout(this.config.generateTimeoutMs),
        model,
        output: Output.object({ schema: diagnosisSynthesisSchema }),
        prompt: this.buildPrompt(containerName, logs),
      });
      return output;
    } catch (error) {
      // an aborted generation (timeout) can surface directly or wrapped as
      // NoObjectGeneratedError — classify timeout first so it maps to 504 not 502.
      if (this.isTimeout(error)) {
        throw new DiagnosisTimeoutError();
      }
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new DiagnosisSynthesisError();
      }
      throw error;
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

  // true when the error is an AbortSignal.timeout firing — either surfaced directly
  // (name TimeoutError/AbortError) or wrapped by the sdk as NoObjectGeneratedError
  // with the abort as its cause.
  private isTimeout(error: unknown): boolean {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return true;
    }
    if (NoObjectGeneratedError.isInstance(error)) {
      const causeName = (error as { cause?: { name?: string } }).cause?.name;
      return causeName === 'TimeoutError' || causeName === 'AbortError';
    }
    return false;
  }
}
