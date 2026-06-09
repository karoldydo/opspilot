import { Directive } from '@angular/core';
import { BrnSelectLabel } from '@spartan-ng/brain/select';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'select-label' },
  hostDirectives: [{ directive: BrnSelectLabel, inputs: ['id'] }],
  selector: '[hlmSelectLabel],hlm-select-label',
})
export class HlmSelectLabel {
  constructor() {
    classes(() => 'text-muted-foreground px-2 py-1.5 text-xs flex');
  }
}
