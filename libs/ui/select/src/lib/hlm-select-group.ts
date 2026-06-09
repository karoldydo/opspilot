import { Directive } from '@angular/core';
import { BrnSelectGroup } from '@spartan-ng/brain/select';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'select-group' },
  hostDirectives: [{ directive: BrnSelectGroup }],
  selector: '[hlmSelectGroup],hlm-select-group',
})
export class HlmSelectGroup {
  constructor() {
    classes(() => 'scroll-my-1 p-1');
  }
}
