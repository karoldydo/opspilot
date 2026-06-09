import { Directive, inject } from '@angular/core';
import { BrnSelectValue } from '@spartan-ng/brain/select';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { '[attr.data-slot]': '!_hidden() ? "select-value" : null' },
  hostDirectives: [{ directive: BrnSelectValue, inputs: ['placeholder'] }],
  selector: '[hlmSelectValue],hlm-select-value',
})
export class HlmSelectValue {
  private readonly _brnSelectValue = inject(BrnSelectValue);

  protected readonly _hidden = this._brnSelectValue.hidden;

  constructor() {
    classes(() => 'data-hidden:hidden');
  }
}
