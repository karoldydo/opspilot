import type { BooleanInput } from '@angular/cdk/coercion';
import type { RouterLink } from '@angular/router';
import type { ClassValue } from 'clsx';

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft } from '@ng-icons/lucide';

import { ButtonVariants } from '../../../button/src/lib/hlm-button';
import { hlm } from '../../../utils/src/lib/hlm';
import { HlmPaginationLink } from './hlm-pagination-link';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmPaginationLink, NgIcon],
  providers: [provideIcons({ lucideChevronLeft })],
  selector: 'hlm-pagination-previous',
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
      <ng-icon class="rtl:rotate-180" name="lucideChevronLeft" />
      <span [class]="_labelClass()">{{ text() }}</span>
    </a>
  `,
})
export class HlmPaginationPrevious {
  public readonly userClass = input<ClassValue>('', { alias: 'class' });
  /** The link to navigate to the previous page. */
  public readonly link = input<RouterLink['routerLink']>();
  /** The query parameters to pass to the previous page. */
  public readonly queryParams = input<RouterLink['queryParams']>();
  /** How to handle query parameters when navigating to the previous page. */
  public readonly queryParamsHandling = input<RouterLink['queryParamsHandling']>();

  /** The aria-label for the previous page link. */
  public readonly ariaLabel = input<string>('Go to previous page', { alias: 'aria-label' });
  /** The text to display for the previous page link. */
  public readonly text = input<string>('Previous');
  /** Whether the button should only display the icon. */
  public readonly iconOnly = input<boolean, BooleanInput>(false, {
    transform: booleanAttribute,
  });

  protected readonly _labelClass = computed(() => hlm(this.iconOnly() ? 'sr-only' : 'hidden sm:block'));

  protected readonly _size = computed<ButtonVariants['size']>(() => (this.iconOnly() ? 'icon' : 'default'));

  protected readonly _computedClass = computed(() => hlm(!this.iconOnly() && 'ps-2!', this.userClass()));
}
