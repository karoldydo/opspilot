import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'empty-header' },
  selector: '[hlmEmptyHeader],hlm-empty-header',
})
export class HlmEmptyHeader {
  constructor() {
    classes(() => 'gap-2 flex max-w-sm flex-col items-center');
  }
}
