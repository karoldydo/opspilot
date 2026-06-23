import { Directive, input } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    '[attr.aria-label]': 'ariaLabel()',
    'data-slot': 'pagination',
    role: 'navigation',
  },
  selector: '[hlmPagination],hlm-pagination',
})
export class HlmPagination {
  /** The aria-label for the pagination component. */
  public readonly ariaLabel = input<string>('pagination', { alias: 'aria-label' });

  constructor() {
    classes(() => 'mx-auto flex w-full justify-center');
  }
}
