import { Directive } from '@angular/core';
import { BrnSelectValues } from '@spartan-ng/brain/select';

@Directive({ hostDirectives: [BrnSelectValues], selector: '[hlmSelectValues]' })
export class HlmSelectValues {}
