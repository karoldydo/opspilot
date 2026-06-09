import { Directive } from '@angular/core';
import { BrnDialogContent } from '@spartan-ng/brain/dialog';

@Directive({
  hostDirectives: [{ directive: BrnDialogContent, inputs: ['context', 'class'] }],
  selector: '[hlmDialogPortal]',
})
export class HlmDialogPortal {}
