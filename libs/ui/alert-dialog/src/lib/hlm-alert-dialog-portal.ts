import { Directive } from '@angular/core';
import { BrnAlertDialogContent } from '@spartan-ng/brain/alert-dialog';

@Directive({
  hostDirectives: [{ directive: BrnAlertDialogContent, inputs: ['context', 'class'] }],
  selector: '[hlmAlertDialogPortal]',
})
export class HlmAlertDialogPortal {}
