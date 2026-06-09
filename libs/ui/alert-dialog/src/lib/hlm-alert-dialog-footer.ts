import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'alert-dialog-footer',
  },
  selector: '[hlmAlertDialogFooter],hlm-alert-dialog-footer',
})
export class HlmAlertDialogFooter {
  constructor() {
    classes(() => 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end');
  }
}
