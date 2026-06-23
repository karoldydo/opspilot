import type { BooleanInput } from '@angular/cdk/coercion';

import { booleanAttribute, Directive, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { buttonVariants, ButtonVariants } from '../../../button/src/lib/hlm-button';
import { classes } from '../../../utils/src/lib/hlm';

@Directive({
  host: {
    '[attr.aria-current]': 'isActive() ? "page" : null',
    '[attr.data-active]': 'isActive() ? "true" : null',
    'data-slot': 'pagination-link',
  },
  hostDirectives: [
    {
      directive: RouterLink,
      inputs: [
        'target',
        'queryParams',
        'fragment',
        'queryParamsHandling',
        'state',
        'info',
        'relativeTo',
        'preserveFragment',
        'skipLocationChange',
        'replaceUrl',
        'routerLink: link',
      ],
    },
  ],
  selector: '[hlmPaginationLink]',
})
export class HlmPaginationLink {
  /** Whether the link is active (i.e., the current page). */
  public readonly isActive = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  /** The size of the button. */
  public readonly size = input<ButtonVariants['size']>('icon');
  /** The link to navigate to the page. */
  public readonly link = input<RouterLink['routerLink']>();

  constructor() {
    classes(() => [
      '',
      buttonVariants({
        size: this.size(),
        variant: this.isActive() ? 'outline' : 'ghost',
      }),
      this.link() === undefined && 'cursor-pointer',
    ]);
  }
}
