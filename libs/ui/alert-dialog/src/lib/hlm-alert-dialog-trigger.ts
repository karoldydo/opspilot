import { Directive } from '@angular/core';
import { BrnAlertDialogTrigger } from '@spartan-ng/brain/alert-dialog';

@Directive({
  host: {
    'data-slot': 'alert-dialog-trigger',
  },
  hostDirectives: [
    { directive: BrnAlertDialogTrigger, inputs: ['id', 'brnAlertDialogTriggerFor: hlmAlertDialogTriggerFor', 'type'] },
  ],
  selector: 'button[hlmAlertDialogTrigger],button[hlmAlertDialogTriggerFor]',
})
export class HlmAlertDialogTrigger {}
