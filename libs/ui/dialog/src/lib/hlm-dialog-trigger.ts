import { Directive } from '@angular/core';
import { BrnDialogTrigger } from '@spartan-ng/brain/dialog';

@Directive({
  host: {
    'data-slot': 'dialog-trigger',
  },
  hostDirectives: [{ directive: BrnDialogTrigger, inputs: ['id', 'brnDialogTriggerFor: hlmDialogTriggerFor', 'type'] }],
  selector: 'button[hlmDialogTrigger],button[hlmDialogTriggerFor]',
})
export class HlmDialogTrigger {}
