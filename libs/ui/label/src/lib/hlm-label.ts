import { Directive } from '@angular/core';
import { BrnLabel } from '@spartan-ng/brain/label';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'label' },
  hostDirectives: [{ directive: BrnLabel, inputs: ['id', 'for'] }],
  selector: '[hlmLabel]',
})
export class HlmLabel {
  constructor() {
    classes(
      () =>
        'gap-2 text-sm leading-none font-medium group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed'
    );
  }
}
