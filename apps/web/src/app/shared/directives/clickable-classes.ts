import { hlm } from '@spartan-ng/helm/utils';

// the canonical clickable-affordance recipe, encoded once. both the opClickable
// directive (native op-* controls) and the dialog-button migration (hlmBtn via twMerge)
// draw their utility string from here — single source of truth, no hand-concatenation.
export type ClickableVariant = 'danger' | 'link' | 'primary' | 'secondary';

// shared fragment for surface-filling controls (buttons / chips): pointer cue,
// card-fill hover, soft active, focus-visible ring. ring color is set per variant.
const surfaceBase =
  'cursor-pointer transition-colors hover:bg-op-surface-card active:bg-op-surface-soft focus-visible:ring-1 focus-visible:outline-none';

// disable-able controls grey out and refuse the pointer when :disabled — the
// disabled: tailwind variant is css-driven, so native buttons need no js to react.
const disabledUtilities = 'disabled:cursor-not-allowed disabled:opacity-60';

// returns the merged utility string for a variant. primary is disable-able by nature
// (submit/create); any other variant can opt into the disabled utilities via opts.disabled.
export function clickableClasses(variant: ClickableVariant, opts: { disabled?: boolean } = {}): string {
  const disabled = variant === 'primary' || opts.disabled === true ? disabledUtilities : '';

  switch (variant) {
    case 'danger':
      // destructive controls swap the focus ring to danger; keep their static danger color trio.
      return hlm(surfaceBase, 'focus-visible:ring-op-danger', disabled);
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
  }
}
