import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    'data-slot': 'dropdown-menu-shortcut',
  },
  selector: '[hlmDropdownMenuShortcut],hlm-dropdown-menu-shortcut',
})
export class HlmDropdownMenuShortcut {
  constructor() {
    classes(() => 'text-muted-foreground ml-auto text-xs tracking-widest');
  }
}
