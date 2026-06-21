import { Directive } from '@angular/core';
import { BrnSeparator } from '@spartan-ng/brain/separator';

import { classes } from '../../../utils/src/lib/hlm';

export const hlmSeparatorClass =
  'inline-flex shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch';

@Directive({
  host: {
    'data-slot': 'separator',
  },
  hostDirectives: [{ directive: BrnSeparator, inputs: ['orientation', 'decorative'] }],
  selector: '[hlmSeparator],hlm-separator',
})
export class HlmSeparator {
  constructor() {
    classes(() => hlmSeparatorClass);
  }
}
