import { Directive, input } from '@angular/core';

import { HlmButton } from '../../../button/src/index';

@Directive({
  host: {
    '[type]': 'type()',
  },
  hostDirectives: [{ directive: HlmButton, inputs: ['variant', 'size'] }],
  selector: 'button[hlmAlertDialogAction]',
})
export class HlmAlertDialogAction {
  public readonly type = input<'button' | 'reset' | 'submit'>('button');
}
