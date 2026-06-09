import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'empty' },
  selector: '[hlmEmpty],hlm-empty',
})
export class HlmEmpty {
  constructor() {
    classes(
      () =>
        'gap-4 rounded-lg border-dashed p-12 flex w-full min-w-0 flex-1 flex-col items-center justify-center text-center text-balance'
    );
  }
}
