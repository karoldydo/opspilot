import { Directive } from '@angular/core';

@Directive({
  host: { 'data-slot': 'pagination-item' },
  selector: 'li[hlmPaginationItem]',
})
export class HlmPaginationItem {}
