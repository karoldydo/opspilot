import { Directive, input } from '@angular/core';
import { classes } from '@spartan-ng/helm/utils';

import { clickableClasses, type ClickableVariant } from './clickable-classes';

@Directive({
  selector: '[appClickable]',
})
export class ClickableDirective {
  readonly variant = input<ClickableVariant>('secondary');

  constructor() {
    classes(() => clickableClasses(this.variant()));
  }
}
