import { Directive } from '@angular/core';
import { BrnDialogDescription } from '@spartan-ng/brain/dialog';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'dialog-description',
  },
  hostDirectives: [BrnDialogDescription],
  selector: '[hlmDialogDescription]',
})
export class HlmDialogDescription {
  constructor() {
    classes(() => 'text-muted-foreground text-sm');
  }
}
