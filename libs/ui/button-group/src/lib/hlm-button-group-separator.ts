import { Directive } from '@angular/core';
import { BrnSeparator, provideBrnSeparatorConfig } from '@spartan-ng/brain/separator';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'button-group-separator',
  },
  hostDirectives: [{ directive: BrnSeparator, inputs: ['orientation', 'decorative'] }],
  providers: [provideBrnSeparatorConfig({ orientation: 'vertical' })],
  selector: '[hlmButtonGroupSeparator],hlm-button-group-separator',
})
export class HlmButtonGroupSeparator {
  constructor() {
    classes(() => [
      'bg-input relative self-stretch data-horizontal:mx-px data-horizontal:w-auto data-vertical:my-px data-vertical:h-auto',
      // separator classes
      'shrink-0 data-horizontal:h-px data-vertical:w-px data-vertical:self-stretch',
    ]);
  }
}
