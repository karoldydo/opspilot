import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { badgeClass } from '@app/shared/status';
import { type DiagnosisSynthesis } from '@opspilot/shared';
import { HlmBadge } from '@spartan-ng/helm/badge';

// the two synthesis treatments this card serves: 'full' reproduces the canonical
// service-detail result card 1:1; 'compact' mirrors the tighter audit expansion row.
type SynthesisDensity = 'compact' | 'full';

// per-density class tokens so one card serves both treatments without forking the markup.
// only the spacing/type-scale differs between them — the structure (badge · summary ·
// problems/suggestions grid) is shared.
const DENSITY: Record<
  SynthesisDensity,
  Record<'badge' | 'empty' | 'grid' | 'header' | 'row' | 'summary' | 'topRow', string>
> = {
  compact: {
    badge: 'px-[9px] py-[2px] text-[10.5px]',
    empty: 'text-op-ash text-[12.5px]',
    grid: 'gap-6',
    header: 'mb-1.5 text-[11.5px] tracking-[0.5px] uppercase',
    row: 'gap-2 py-1 text-[12.5px]',
    summary: 'text-[14px]',
    topRow: 'gap-[10px]',
  },
  full: {
    badge: 'px-[10px] py-[3px] text-[11px]',
    empty: 'text-op-ash text-[13px]',
    grid: 'gap-7',
    header: 'mb-2 text-[12px]',
    row: 'border-op-hairline border-b gap-[9px] py-1.5 text-[13px]',
    summary: 'text-op-ink text-[14.5px]',
    topRow: 'gap-3',
  },
};

// one reusable card rendering a diagnosis synthesis: status badge + summary + the two-column
// problems/suggestions grid. extracted from the canonical service-detail markup so audit can
// reuse it without a fourth inline copy. accepts a partial synthesis because the diagnose
// stream fills it progressively (status/summary/lists arrive over time) — the badge and lists
// stay hidden until their fields land, matching the prior inline behavior.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmBadge],
  selector: 'app-synthesis-card',
  template: `
    <div class="mb-4 flex flex-wrap items-center {{ tokens().topRow }}">
      @if (synthesis().status; as status) {
        <span
          class="font-bold tracking-[0.5px] uppercase {{ tokens().badge }} {{ badgeClass(status) }}"
          hlmBadge
          variant="ghost"
          >{{ status }}</span
        >
      }
      <span class="min-w-0 break-words {{ tokens().summary }}">{{ synthesis().summary || 'diagnosing…' }}</span>
    </div>
    <div class="grid sm:grid-cols-2 {{ tokens().grid }}">
      <div class="min-w-0">
        <div class="text-op-warning-text font-bold {{ tokens().header }}">problems</div>
        @if (synthesis().problems; as problems) {
          @for (problem of problems; track $index) {
            <div class="text-op-body flex {{ tokens().row }}">
              <span class="text-op-danger flex-none font-bold">[x]</span
              ><span class="min-w-0 break-words">{{ problem }}</span>
            </div>
          } @empty {
            <div class="{{ tokens().empty }}">none detected.</div>
          }
        }
      </div>
      <div class="min-w-0">
        <div class="text-op-success-text font-bold {{ tokens().header }}">suggestions</div>
        @if (synthesis().suggestions; as suggestions) {
          @for (suggestion of suggestions; track $index) {
            <div class="text-op-body flex {{ tokens().row }}">
              <span class="text-op-success-text flex-none font-bold">[+]</span
              ><span class="min-w-0 break-words">{{ suggestion }}</span>
            </div>
          } @empty {
            <div class="{{ tokens().empty }}">none.</div>
          }
        }
      </div>
    </div>
  `,
})
export class SynthesisCardComponent {
  // the synthesis to render — partial while a stream is mid-flight, complete for a saved run.
  readonly synthesis = input.required<Partial<DiagnosisSynthesis>>();

  // 'full' (service-detail) by default; audit passes 'compact'.
  readonly density = input<SynthesisDensity>('full');

  // status → badge classes, from the shared status util (single source of truth).
  protected readonly badgeClass = badgeClass;

  // the active density's class tokens.
  protected readonly tokens = computed(() => DENSITY[this.density()]);
}
