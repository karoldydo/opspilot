import { Directive } from '@angular/core';
import { BrnAlertDialogTitle } from '@spartan-ng/brain/alert-dialog';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'alert-dialog-title',
  },
  hostDirectives: [BrnAlertDialogTitle],
  selector: '[hlmAlertDialogTitle]',
})
export class HlmAlertDialogTitle {
  constructor() {
    classes(() => 'text-lg font-semibold');
  }
}
