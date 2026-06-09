import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'dialog-header',
  },
  selector: '[hlmDialogHeader],hlm-dialog-header',
})
export class HlmDialogHeader {
  constructor() {
    classes(() => 'flex flex-col gap-2 text-center sm:text-start');
  }
}
