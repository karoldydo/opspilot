import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'dialog-footer',
  },
  selector: '[hlmDialogFooter],hlm-dialog-footer',
})
export class HlmDialogFooter {
  constructor() {
    classes(() => 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end');
  }
}
