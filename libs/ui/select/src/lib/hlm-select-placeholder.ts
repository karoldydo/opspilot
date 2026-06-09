import { Directive } from '@angular/core';
import { BrnSelectPlaceholder } from '@spartan-ng/brain/select';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'select-placeholder' },
  hostDirectives: [BrnSelectPlaceholder],
  selector: '[hlmSelectPlaceholder],hlm-select-placeholder',
})
export class HlmSelectPlaceholder {
  constructor() {
    classes(
      () =>
        "gap-2 [&_ng-icon:not([class*='text-'])]:text-[calc(var(--spacing)*4)] flex items-center data-hidden:hidden [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0"
    );
  }
}
