import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'table-container' },
  selector: 'div[hlmTableContainer]',
})
export class HlmTableContainer {
  constructor() {
    classes(() => 'relative w-full overflow-x-auto');
  }
}

/**
 * Directive to apply Shadcn-like styling to a <table> element.
 */
@Directive({
  host: { 'data-slot': 'table' },
  selector: 'table[hlmTable]',
})
export class HlmTable {
  constructor() {
    classes(() => 'w-full caption-bottom text-sm');
  }
}

/**
 * Directive to apply Shadcn-like styling to a <thead> element
 * within an HlmTable context.
 */
@Directive({
  host: { 'data-slot': 'table-header' },
  selector: 'thead[hlmTHead],thead[hlmTableHeader]',
})
export class HlmTHead {
  constructor() {
    classes(() => '[&_tr]:border-b');
  }
}

/**
 * Directive to apply Shadcn-like styling to a <tbody> element
 * within an HlmTable context.
 */
@Directive({
  host: { 'data-slot': 'table-body' },
  selector: 'tbody[hlmTBody],tbody[hlmTableBody]',
})
export class HlmTBody {
  constructor() {
    classes(() => '[&_tr:last-child]:border-0');
  }
}

/**
 * Directive to apply Shadcn-like styling to a <tfoot> element
 * within an HlmTable context.
 */
@Directive({
  host: { 'data-slot': 'table-footer' },
  selector: 'tfoot[hlmTFoot],tfoot[hlmTableFooter]',
})
export class HlmTFoot {
  constructor() {
    classes(() => 'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0');
  }
}

/**
 * Directive to apply Shadcn-like styling to a <tr> element
 * within an HlmTable context.
 */
@Directive({
  host: { 'data-slot': 'table-row' },
  selector: 'tr[hlmTr],tr[hlmTableRow]',
})
export class HlmTr {
  constructor() {
    classes(
      () => 'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors has-aria-expanded:bg-muted/50'
    );
  }
}

/**
 * Directive to apply Shadcn-like styling to a <th> element
 * within an HlmTable context.
 */
@Directive({
  host: { 'data-slot': 'table-head' },
  selector: 'th[hlmTh],th[hlmTableHead]',
})
export class HlmTh {
  constructor() {
    classes(
      () =>
        'text-foreground h-10 px-2 text-start align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pe-0'
    );
  }
}

/**
 * Directive to apply Shadcn-like styling to a <td> element
 * within an HlmTable context.
 */
@Directive({
  host: { 'data-slot': 'table-cell' },
  selector: 'td[hlmTd],td[hlmTableCell]',
})
export class HlmTd {
  constructor() {
    classes(() => 'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pe-0');
  }
}

/**
 * Directive to apply Shadcn-like styling to a <caption> element
 * within an HlmTable context.
 */
@Directive({
  host: { 'data-slot': 'table-caption' },
  selector: 'caption[hlmCaption],caption[hlmTableCaption]',
})
export class HlmCaption {
  constructor() {
    classes(() => 'text-muted-foreground mt-4 text-sm');
  }
}
