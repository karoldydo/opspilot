import { Directive } from '@angular/core';
import { BrnAlertDialogDescription } from '@spartan-ng/brain/alert-dialog';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'alert-dialog-description',
  },
  hostDirectives: [BrnAlertDialogDescription],
  selector: '[hlmAlertDialogDescription]',
})
export class HlmAlertDialogDescription {
  constructor() {
    classes(() => 'text-muted-foreground text-sm');
  }
}
