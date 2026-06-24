import { Directive, input } from '@angular/core';
import { cva } from 'class-variance-authority';

import { classes } from '../../../utils/src/lib/hlm';

const buttonGroupVariants = cva(
  "has-[>[data-slot=button-group]]:gap-2 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10 [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
  {
    defaultVariants: {
      orientation: 'horizontal',
    },
    variants: {
      orientation: {
        horizontal:
          '[&>[data-slot]:not(:has(~[data-slot]))]:rounded-r-md! [&>*:not(:first-child)]:rounded-s-none [&>*:not(:first-child)]:border-s-0 [&>*:not(:last-child)]:rounded-e-none',
        vertical:
          '[&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-md! flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none',
      },
    },
  }
);

@Directive({
  host: {
    '[attr.data-orientation]': 'orientation()',
    'data-slot': 'button-group',
    role: 'group',
  },
  selector: '[hlmButtonGroup],hlm-button-group',
})
export class HlmButtonGroup {
  constructor() {
    classes(() => buttonGroupVariants({ orientation: this.orientation() }));
  }

  public readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
}
