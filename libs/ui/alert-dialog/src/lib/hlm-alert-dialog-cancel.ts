import { Directive, input } from '@angular/core';

import { HlmButton } from '../../../button/src/index';
import { provideBrnButtonConfig } from '../../../button/src/lib/hlm-button.token';

@Directive({
  host: {
    '[type]': 'type()',
  },
  hostDirectives: [{ directive: HlmButton, inputs: ['variant', 'size'] }],
  providers: [provideBrnButtonConfig({ variant: 'outline' })],
  selector: 'button[hlmAlertDialogCancel]',
})
export class HlmAlertDialogCancel {
  public readonly type = input<'button' | 'reset' | 'submit'>('button');
}
