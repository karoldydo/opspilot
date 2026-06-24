import { Directive, input } from '@angular/core';

import { HlmButton } from '../../../button/src/index';
import { provideBrnButtonConfig } from '../../../button/src/lib/hlm-button.token';

@Directive({
  host: {
    '[type]': 'type()',
  },
  hostDirectives: [{ directive: HlmButton, inputs: ['variant', 'size'] }],
  // the confirm action is the destructive button by default: dark fill + danger ring.
  providers: [provideBrnButtonConfig({ variant: 'destructive-solid' })],
  selector: 'button[hlmAlertDialogAction]',
})
export class HlmAlertDialogAction {
  public readonly type = input<'button' | 'reset' | 'submit'>('button');
}
