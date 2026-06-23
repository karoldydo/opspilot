import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { DiagnosisClient } from '@app/features/diagnosis/data/diagnosis.client';
import { DiagnosisStore } from '@app/features/diagnosis/data/diagnosis.store';
import { ServiceSkillsComponent } from '@app/features/services/components/service-skills.component';
import { ServicesClient } from '@app/features/services/data/services.client';
import { ServicesStore } from '@app/features/services/data/services.store';
import {
  RenameServiceDialog,
  type RenameServiceDialogContext,
} from '@app/features/services/dialogs/rename-service.dialog';
import { clickableClasses } from '@app/shared/directives/clickable-classes';
import { ClickableDirective } from '@app/shared/directives/clickable.directive';
import { type Device, type DiagnosisSynthesis, type RunRecord, type RunStep, type Service } from '@opspilot/shared';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

// status → synthesis-badge fill (cream text on the on-cream status ramp, mockup statusBadge()).
const BADGE_CLASS: Record<DiagnosisSynthesis['status'], string> = {
  degraded: 'bg-op-warning text-op-cream',
  down: 'bg-op-danger text-op-cream',
  healthy: 'bg-op-success-text text-op-cream',
};

// unknown is client-only (not in the wire enum) — a neutral grey badge for a service with
// no runs, so it never reads as green. kept off the BADGE_CLASS map, which is keyed on the
// three real statuses only.
const UNKNOWN_BADGE = 'bg-op-surface-card text-op-mute';

// status → recent-run dot text color (the ● glyph in a replay chip).
const DOT_CLASS: Record<DiagnosisSynthesis['status'], string> = {
  degraded: 'text-op-warning',
  down: 'text-op-danger',
  healthy: 'text-op-success-text',
};

// step kind → terminal prefix glyph + line color (mockup palette, mirrors diagnose-hero).
const STEP_CLASS: Record<RunStep['kind'], { colorClass: string; prefix: string }> = {
  cmd: { colorClass: 'text-op-cream', prefix: '$' },
  ok: { colorClass: 'text-op-success', prefix: '+' },
  result: { colorClass: 'text-op-terminal-blue', prefix: '=' },
  sys: { colorClass: 'text-op-ash', prefix: '·' },
  warn: { colorClass: 'text-op-warning', prefix: '!' },
};

// the service detail page: the full operational surface for one service (identity, operations,
// the live diagnosis stream + result, and replay history), reachable by deep-link. generalizes
// diagnose-hero by resolving the Service via the single-service read and seeding the result card
// from the latest saved run on entry (no auto-stream). store + clients provided here (not
// providedIn: 'root', per angular.md) so the screen owns its lifecycle; dialogs get the store via
// context since they render in a cdk overlay outside this injector.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink, ClickableDirective, ServiceSkillsComponent, ...HlmAlertDialogImports],
  providers: [ServicesClient, ServicesStore, DiagnosisClient, DiagnosisStore, DevicesClient],
  selector: 'app-service-detail',
  templateUrl: './service-detail.component.html',
})
export class ServiceDetailComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly devicesClient = inject(DevicesClient);
  private readonly dialog = inject(HlmDialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly servicesClient = inject(ServicesClient);

  protected readonly diagnosis = inject(DiagnosisStore);

  protected readonly store = inject(ServicesStore);

  // route ids as signals so the screen tracks navigation without zone cd.
  private readonly paramMap = toSignal(this.route.paramMap);

  protected readonly deviceId = computed(() => this.paramMap()?.get('deviceId') ?? '');

  protected readonly serviceId = computed(() => this.paramMap()?.get('serviceId') ?? '');

  // resolved service identity (deep-link safe via getService); null until resolved / not found.
  protected readonly service = signal<null | Service>(null);

  protected readonly serviceError = signal<null | string>(null);

  protected readonly serviceLoading = signal(true);

  // owning device — name + host for the breadcrumb/meta line. non-fatal: a failed read just
  // falls back to the raw id with no host (the meta line stays useful).
  protected readonly device = signal<Device | null>(null);

  protected readonly deviceName = computed(() => this.device()?.name ?? this.deviceId());

  protected readonly serviceName = computed(() => this.service()?.name ?? this.serviceId());

  // op-* affordances for the alert-dialog confirm/cancel buttons; merged over hlmBtn's cva.
  protected readonly dangerSolidAffordance = clickableClasses('danger-solid');

  protected readonly secondaryAffordance = clickableClasses('secondary');

  // the live diagnosis slice for this service; reads the store's entries signal so the template
  // tracks each streamed frame.
  protected readonly entry = computed(() => this.diagnosis.entry(this.serviceId()));

  // newest saved run (runs[0]), used to seed a passive last-run result on entry.
  protected readonly latestRun = computed<null | RunRecord>(() => this.entry().runs[0] ?? null);

  // the synthesis to render — a live/replayed result, the progressive partial mid-stream, else
  // the latest saved run so the page is informative on entry without auto-streaming.
  protected readonly view = computed(
    () => this.entry().result ?? this.entry().partial ?? this.latestRun()?.synthesis ?? null
  );

  // true when the rendered view is the passive latest run (no fresh/replayed result this session)
  // — drives the "last run · {date}" label.
  protected readonly isLatest = computed(() => !this.entry().result && !this.entry().partial && !!this.latestRun());

  // opening narration burst — every step but a trailing `result` done-line (mirrors diagnose-hero).
  protected readonly leadSteps = computed(() => {
    const steps = this.entry().steps;
    return steps[steps.length - 1]?.kind === 'result' ? steps.slice(0, -1) : steps;
  });

  // the closing `= done in Xs` line, rendered after the synthesis summary (null until complete).
  protected readonly doneStep = computed(() => {
    const steps = this.entry().steps;
    const last = steps[steps.length - 1];
    return last?.kind === 'result' ? last : null;
  });

  // compose meta: "compose · {project} · {path}" or "standalone container" (composePath/project
  // are null on a standalone container).
  protected readonly composeLabel = computed(() => {
    const service = this.service();
    if (service && (service.composeProject || service.composePath)) {
      return `compose · ${service.composeProject ?? '—'} · ${service.composePath ?? '—'}`;
    }
    return 'standalone container';
  });

  // resolve the service once the route ids bind — never in the constructor (ng0950).
  private readonly serviceEffect = effect(() => {
    const deviceId = this.deviceId();
    const serviceId = this.serviceId();
    if (deviceId && serviceId) {
      void this.resolveService(deviceId, serviceId);
    }
  });

  // resolve the owning device for the breadcrumb/meta (existing list read, find by id).
  private readonly deviceEffect = effect(() => {
    const deviceId = this.deviceId();
    if (deviceId && this.device()?.id !== deviceId) {
      void this.resolveDevice(deviceId);
    }
  });

  // serviceIds whose replay history has been fetched — one load per service.
  private readonly loadedRuns = new Set<string>();

  // load the replay history once the route ids resolve (guarded, mirrors device-services).
  private readonly runsEffect = effect(() => {
    const deviceId = this.deviceId();
    const serviceId = this.serviceId();
    if (deviceId && serviceId && !this.loadedRuns.has(serviceId)) {
      this.loadedRuns.add(serviceId);
      void this.diagnosis.loadRuns(deviceId, serviceId);
    }
  });

  // status → synthesis-badge fill; null (unknown) falls back to the neutral grey badge.
  badgeClass(status: DiagnosisSynthesis['status'] | null): string {
    return status ? BADGE_CLASS[status] : UNKNOWN_BADGE;
  }

  async confirmDelete(dialog: { close: () => void }): Promise<void> {
    const service = this.service();
    if (!service) {
      dialog.close();
      return;
    }
    const result = await this.store.remove(this.deviceId(), service.id);
    dialog.close();
    if (result.error) {
      toast('[x] could not delete service');
      return;
    }
    toast('[-] service deleted');
    void this.router.navigate(['/devices']);
  }

  // status → recent-run dot text color.
  dotClass(status: DiagnosisSynthesis['status']): string {
    return DOT_CLASS[status];
  }

  // opens the rename dialog and re-resolves the service on success so the header reflects the
  // new name (the store refetches its list, but this page reads from the getService signal).
  openRename(): void {
    const service = this.service();
    if (!service) {
      return;
    }
    const context: RenameServiceDialogContext = { deviceId: this.deviceId(), service, store: this.store };
    const ref = this.dialog.open(RenameServiceDialog, { context });
    ref.closed$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((renamed) => {
      if (renamed) {
        void this.resolveService(this.deviceId(), this.serviceId());
      }
    });
  }

  // renders a saved run statically in the result card — no re-stream (frame d5).
  replay(run: RunRecord): void {
    this.diagnosis.replay(this.serviceId(), run);
  }

  // re-opens the live sse stream for this service; the store keys the progressive partial +
  // final result and tears the stream down on completion.
  rerun(): void {
    this.diagnosis.stream(this.deviceId(), this.serviceId());
  }

  // step kind → terminal prefix glyph + line color (mockup palette).
  stepClass(kind: RunStep['kind']): { colorClass: string; prefix: string } {
    return STEP_CLASS[kind];
  }

  private async resolveDevice(deviceId: string): Promise<void> {
    try {
      const devices = await this.devicesClient.listDevices();
      this.device.set(devices.find((device) => device.id === deviceId) ?? null);
    } catch {
      // non-fatal — the breadcrumb/meta fall back to the raw id with no host.
    }
  }

  private async resolveService(deviceId: string, serviceId: string): Promise<void> {
    this.serviceLoading.set(true);
    this.serviceError.set(null);
    try {
      this.service.set(await this.servicesClient.getService(deviceId, serviceId));
    } catch (error) {
      this.service.set(null);
      this.serviceError.set(
        error instanceof HttpErrorResponse && error.status === 404 ? 'service not found' : 'could not load service'
      );
    } finally {
      this.serviceLoading.set(false);
    }
  }
}
