import type { BooleanInput, NumberInput } from '@angular/cdk/coercion';
import type { ClassValue } from 'clsx';

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, numberAttribute } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleCheck, lucideInfo, lucideLoader2, lucideOctagonX, lucideTriangleAlert } from '@ng-icons/lucide';
import { BrnSonnerImports, type ToasterProps } from '@spartan-ng/brain/sonner';

import { hlm } from '../../../utils/src/lib/hlm';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrnSonnerImports, NgIcon],
  providers: [provideIcons({ lucideCircleCheck, lucideInfo, lucideLoader2, lucideOctagonX, lucideTriangleAlert })],
  selector: 'hlm-toaster',
  template: `
    <brn-sonner-toaster
      [class]="_computedClass()"
      [closeButton]="closeButton()"
      [duration]="duration()"
      [expand]="expand()"
      [hotKey]="hotKey()"
      [invert]="invert()"
      [offset]="offset()"
      [position]="position()"
      [richColors]="richColors()"
      [style]="userStyle()"
      [theme]="theme()"
      [toastOptions]="_computedToastOptions()"
      [visibleToasts]="visibleToasts()"
    >
      <ng-template #loadingIcon>
        <ng-icon class="overflow-visible! text-base [&>svg]:motion-safe:animate-spin" name="lucideLoader2" />
      </ng-template>
      <ng-template #successIcon>
        <ng-icon class="overflow-visible! text-base" name="lucideCircleCheck" />
      </ng-template>
      <ng-template #errorIcon>
        <ng-icon class="overflow-visible! text-base" name="lucideOctagonX" />
      </ng-template>
      <ng-template #infoIcon>
        <ng-icon class="overflow-visible! text-base" name="lucideInfo" />
      </ng-template>
      <ng-template #warningIcon>
        <ng-icon class="overflow-visible! text-base" name="lucideTriangleAlert" />
      </ng-template>
    </brn-sonner-toaster>
  `,
})
export class HlmToaster {
  public readonly invert = input<ToasterProps['invert'], BooleanInput>(false, {
    transform: booleanAttribute,
  });

  public readonly theme = input<ToasterProps['theme']>('light');
  public readonly position = input<ToasterProps['position']>('bottom-right');
  public readonly hotKey = input<ToasterProps['hotkey']>(['altKey', 'KeyT']);
  public readonly richColors = input<ToasterProps['richColors'], BooleanInput>(false, {
    transform: booleanAttribute,
  });

  public readonly expand = input<ToasterProps['expand'], BooleanInput>(false, {
    transform: booleanAttribute,
  });

  public readonly duration = input<ToasterProps['duration'], NumberInput>(4000, {
    transform: numberAttribute,
  });

  public readonly visibleToasts = input<ToasterProps['visibleToasts'], NumberInput>(3, {
    transform: numberAttribute,
  });

  public readonly closeButton = input<ToasterProps['closeButton'], BooleanInput>(false, {
    transform: booleanAttribute,
  });

  public readonly toastOptions = input<ToasterProps['toastOptions']>({});

  protected readonly _computedToastOptions = computed(() => {
    const options = this.toastOptions();
    return {
      ...options,
      classes: {
        ...options?.classes,
        toast: hlm('rounded-2xl!', options?.classes?.toast),
      },
    };
  });

  public readonly offset = input<ToasterProps['offset']>(null);
  public readonly userClass = input<ClassValue>('', { alias: 'class' });
  public readonly userStyle = input<Record<string, string>>(
    {
      '--border-radius': 'var(--radius)',
      '--normal-bg': 'var(--popover)',
      '--normal-border': 'var(--border)',
      '--normal-text': 'var(--popover-foreground)',
    },
    { alias: 'style' }
  );

  protected readonly _computedClass = computed(() => hlm('toaster group', this.userClass()));
}
