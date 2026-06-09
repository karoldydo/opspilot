import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'empty-content' },
  selector: '[hlmEmptyContent],hlm-empty-content',
})
export class HlmEmptyContent {
  constructor() {
    classes(() => 'gap-4 text-sm flex w-full max-w-sm min-w-0 flex-col items-center text-balance');
  }
}
