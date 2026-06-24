import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'dropdown-menu-separator',
  },
  selector: '[hlmDropdownMenuSeparator],hlm-dropdown-menu-separator',
})
export class HlmDropdownMenuSeparator {
  constructor() {
    classes(() => 'bg-border -mx-1 my-1 block h-px');
  }
}
