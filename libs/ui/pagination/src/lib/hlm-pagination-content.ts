import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'pagination-content' },
  selector: 'ul[hlmPaginationContent]',
})
export class HlmPaginationContent {
  constructor() {
    classes(() => 'gap-1 flex items-center');
  }
}
