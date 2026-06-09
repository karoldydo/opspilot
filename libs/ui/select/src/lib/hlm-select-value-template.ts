import { Directive } from '@angular/core';
import { BrnSelectValueTemplate } from '@spartan-ng/brain/select';

@Directive({ hostDirectives: [BrnSelectValueTemplate], selector: '[hlmSelectValueTemplate]' })
export class HlmSelectValueTemplate {}
