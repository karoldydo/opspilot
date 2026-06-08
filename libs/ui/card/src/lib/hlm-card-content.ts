import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'card-content',
  },
  selector: '[hlmCardContent]',
})
export class HlmCardContent {
  constructor() {
    classes(() => 'px-6 group-data-[size=sm]/card:px-4');
  }
}
