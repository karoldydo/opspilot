import { Directive } from '@angular/core';

import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: { 'data-slot': 'empty-description' },
  selector: '[hlmEmptyDescription]',
})
export class HlmEmptyDescription {
  constructor() {
    classes(
      () => 'text-sm/relaxed text-muted-foreground [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4'
    );
  }
}
