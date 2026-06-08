import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'card-title',
  },
  selector: '[hlmCardTitle]',
})
export class HlmCardTitle {
  constructor() {
    classes(() => 'text-base leading-normal font-medium group-data-[size=sm]/card:text-sm');
  }
}
