import { Directive } from '@angular/core';
import { BrnDialogTitle } from '@spartan-ng/brain/dialog';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'dialog-title',
  },
  hostDirectives: [BrnDialogTitle],
  selector: '[hlmDialogTitle]',
})
export class HlmDialogTitle {
  constructor() {
    classes(() => 'text-lg leading-none font-semibold');
  }
}
