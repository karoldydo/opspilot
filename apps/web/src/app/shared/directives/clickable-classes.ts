import { hlm } from '@spartan-ng/helm/utils';

// the canonical clickable-affordance recipe, encoded once. both the opClickable
// directive (native op-* controls) and the dialog-button migration (hlmBtn via twMerge)
// draw their utility string from here — single source of truth, no hand-concatenation.
export type ClickableVariant = 'danger-solid' | 'danger' | 'link' | 'primary' | 'secondary' | 'solid';

// shared fragment for light surface-filling controls (cream buttons / chips / outline):
// pointer cue, card-fill hover, soft active, focus-visible ring. ring color is set per variant.
const surfaceBase =
  'cursor-pointer transition-colors hover:bg-op-surface-card active:bg-op-surface-soft focus-visible:ring-1 focus-visible:outline-none';

// shared fragment for dark solid controls (hlmbtn default fill = op-ink bg + cream text):
// a light-surface hover would wash the cream text out, so dark buttons stay in the dark range —
// deepen to ink-deep on hover/active (darker, never lighter) so the cream text gains contrast
// rather than washing out. ring per variant.
const solidBase =
  'cursor-pointer transition-colors hover:bg-op-ink-deep active:bg-op-ink-deep focus-visible:ring-1 focus-visible:outline-none';

// disable-able controls grey out and refuse the pointer when :disabled — the
// disabled: tailwind variant is css-driven, so native buttons need no js to react.
const disabledUtilities = 'disabled:cursor-not-allowed disabled:opacity-60';

// variants whose controls are disable-able by nature (form submit / create / confirm).
const disableAwareVariants = new Set<ClickableVariant>(['danger-solid', 'primary', 'solid']);

// returns the merged utility string for a variant. submit/create/confirm variants are
// disable-able by nature; any other variant can opt into the disabled utilities via opts.disabled.
export function clickableClasses(variant: ClickableVariant, opts: { disabled?: boolean } = {}): string {
  const disabled = disableAwareVariants.has(variant) || opts.disabled === true ? disabledUtilities : '';

  switch (variant) {
    case 'danger':
      // destructive controls swap the focus ring to danger; keep their static danger color trio.
      return hlm(surfaceBase, 'focus-visible:ring-op-danger', disabled);
    case 'danger-solid':
      // dark destructive confirm (hlmbtn default fill): stays dark + legible like solid,
      // with a danger focus ring so the destructive intent reads on the dark surface.
      return hlm(solidBase, 'focus-visible:ring-op-danger', disabled);
    case 'link':
      // links read as links: underline on hover, no card-fill surface change.
      return hlm(
        'cursor-pointer transition-colors underline-offset-4 hover:underline focus-visible:ring-1 focus-visible:ring-op-ink focus-visible:outline-none',
        disabled
      );
    case 'primary':
      return hlm(surfaceBase, 'focus-visible:ring-op-ink', disabled);
    case 'secondary':
      // bordered controls also darken the border on hover.
      return hlm(surfaceBase, 'focus-visible:ring-op-ink', 'hover:border-op-hairline-strong', disabled);
    case 'solid':
      // dark neutral solid (hlmbtn default fill): cream focus ring so focus is visible on the dark surface.
      return hlm(solidBase, 'focus-visible:ring-op-cream', disabled);
  }
}
