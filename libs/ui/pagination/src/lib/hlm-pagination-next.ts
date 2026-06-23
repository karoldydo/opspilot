import type { BooleanInput } from '@angular/cdk/coercion';
import type { RouterLink } from '@angular/router';
import type { ClassValue } from 'clsx';

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';

import { ButtonVariants } from '../../../button/src/lib/hlm-button';
import { hlm } from '../../../utils/src/lib/hlm';
import { HlmPaginationLink } from './hlm-pagination-link';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmPaginationLink, NgIcon],
  providers: [provideIcons({ lucideChevronRight })],
  selector: 'hlm-pagination-next',
  template: `
    <a
      [attr.aria-label]="ariaLabel()"
      [class]="_computedClass()"
      [link]="link()"
      [queryParams]="queryParams()"
      [queryParamsHandling]="queryParamsHandling()"
      [size]="_size()"
      hlmPaginationLink
    >
      <span [class]="_labelClass()">{{ text() }}</span>
      <ng-icon class="rtl:rotate-180" name="lucideChevronRight" />
    </a>
  `,
})
export class HlmPaginationNext {
  public readonly userClass = input<ClassValue>('', { alias: 'class' });
  /** The link to navigate to the next page. */
  public readonly link = input<RouterLink['routerLink']>();
  /** The query parameters to pass to the next page. */
  public readonly queryParams = input<RouterLink['queryParams']>();
  /** How to handle query parameters when navigating to the next page. */
  public readonly queryParamsHandling = input<RouterLink['queryParamsHandling']>();

  /** The aria-label for the next page link. */
  public readonly ariaLabel = input<string>('Go to next page', { alias: 'aria-label' });
  /** The text to display for the next page link. */
  public readonly text = input<string>('Next');
  /** Whether the button should only display the icon. */
  public readonly iconOnly = input<boolean, BooleanInput>(false, {
    transform: booleanAttribute,
  });

  protected readonly _labelClass = computed(() => (this.iconOnly() ? 'sr-only' : 'hidden sm:block'));

  protected readonly _size = computed<ButtonVariants['size']>(() => (this.iconOnly() ? 'icon' : 'default'));

  protected readonly _computedClass = computed(() => hlm(!this.iconOnly() && 'pe-2!', this.userClass()));
}
