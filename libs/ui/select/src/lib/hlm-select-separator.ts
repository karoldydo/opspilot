import { Directive } from '@angular/core';
import { BrnSelectSeparator } from '@spartan-ng/brain/select';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'select-separator' },
  hostDirectives: [{ directive: BrnSelectSeparator, inputs: ['orientation'] }],
  selector: '[hlmSelectSeparator],hlm-select-separator',
})
export class HlmSelectSeparator {
  constructor() {
    classes(() => 'bg-border -mx-1 my-1 h-px pointer-events-none');
  }
}
