import type { ClassValue } from 'clsx';

import { computed, Directive, effect, input, untracked } from '@angular/core';
import { BrnAlertDialogOverlay } from '@spartan-ng/brain/alert-dialog';
import { injectCustomClassSettable } from '@spartan-ng/brain/core';

import { hlm } from '../../../utils/src/lib/hlm';

@Directive({
  hostDirectives: [BrnAlertDialogOverlay],
  selector: '[hlmAlertDialogOverlay],hlm-alert-dialog-overlay',
})
export class HlmAlertDialogOverlay {
  private readonly _classSettable = injectCustomClassSettable({ host: true, optional: true });

  public readonly userClass = input<ClassValue>('', { alias: 'class' });
  protected readonly _computedClass = computed(() =>
    hlm(
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 bg-black/50',
      this.userClass()
    )
  );

  constructor() {
    effect(() => {
      const classValue = this._computedClass();
      untracked(() => this._classSettable?.setClassToCustomElement(classValue));
    });
  }
}
