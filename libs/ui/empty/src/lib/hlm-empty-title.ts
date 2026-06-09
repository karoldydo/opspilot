import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'empty-title' },
  selector: '[hlmEmptyTitle]',
})
export class HlmEmptyTitle {
  constructor() {
    classes(() => 'text-lg font-medium tracking-tight');
  }
}
