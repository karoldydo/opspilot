import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoader2 } from '@ng-icons/lucide';

import { classes } from '../../../utils/src/lib/hlm';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-label]': 'ariaLabel()',
    role: 'status',
  },
  imports: [NgIcon],
  providers: [provideIcons({ lucideLoader2 })],
  selector: 'hlm-spinner',
  template: ` <ng-icon [name]="icon()" /> `,
})
export class HlmSpinner {
  /**
   * The name of the icon to be used as the spinner.
   * Use provideIcons({ ... }) to register custom icons.
   */
  public readonly icon = input<string>('lucideLoader2');

  /** Aria label for the spinner for accessibility. */
  public readonly ariaLabel = input<string>('Loading', { alias: 'aria-label' });

  constructor() {
    classes(() => 'inline-flex text-[calc(var(--spacing)*4)] motion-safe:animate-spin');
  }
}
