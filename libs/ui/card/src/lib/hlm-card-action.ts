import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'card-action',
  },
  selector: '[hlmCardAction]',
})
export class HlmCardAction {
  constructor() {
    classes(() => 'col-start-2 row-span-2 row-start-1 self-start justify-self-end');
  }
}
