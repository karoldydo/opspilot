import { Directive } from '@angular/core';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';

@Directive({
  hostDirectives: [{ directive: BrnPopoverContent, inputs: ['context', 'class'] }],
  selector: '[hlmSelectPortal]',
})
export class HlmSelectPortal {}
