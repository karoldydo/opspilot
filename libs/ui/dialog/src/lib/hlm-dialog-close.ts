import { Directive } from '@angular/core';
import { BrnDialogClose } from '@spartan-ng/brain/dialog';

@Directive({
  host: {
    'data-slot': 'dialog-close',
  },
  hostDirectives: [{ directive: BrnDialogClose, inputs: ['delay'] }],
  selector: 'button[hlmDialogClose]',
})
export class HlmDialogClose {}
