import { CdkMenuGroup } from '@angular/cdk/menu';
import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'dropdown-menu-group',
  },
  hostDirectives: [CdkMenuGroup],
  selector: '[hlmDropdownMenuGroup],hlm-dropdown-menu-group',
})
export class HlmDropdownMenuGroup {
  constructor() {
    classes(() => 'block');
  }
}
