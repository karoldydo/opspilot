import { Directive, input } from '@angular/core';
import { cva, VariantProps } from 'class-variance-authority';

import { classes } from '../../../utils/src/lib/hlm';

const emptyMediaVariants = cva(
  'mb-2 flex shrink-0 items-center justify-center [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0',
  {
    defaultVariants: {
      variant: 'default',
    },
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: "bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_ng-icon:not([class*='text-'])]:text-[calc(var(--spacing)*6)]",
      },
    },
  }
);

export type EmptyMediaVariants = VariantProps<typeof emptyMediaVariants>;

@Directive({
  host: {
    '[attr.data-variant]': 'variant()',
    'data-slot': 'empty-media',
  },
  selector: '[hlmEmptyMedia],hlm-empty-media',
})
export class HlmEmptyMedia {
  public readonly variant = input<EmptyMediaVariants['variant']>();

  constructor() {
    classes(() => emptyMediaVariants({ variant: this.variant() }));
  }
}
