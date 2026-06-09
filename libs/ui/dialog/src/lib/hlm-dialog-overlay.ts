import { computed, Directive, effect, input, untracked } from '@angular/core';
import { injectCustomClassSettable } from '@spartan-ng/brain/core';
import { BrnDialogOverlay } from '@spartan-ng/brain/dialog';
import { ClassValue } from 'clsx';

import { hlm } from '../../../utils/src/lib/hlm';

export const hlmDialogOverlayClass =
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 bg-black/50';

@Directive({
  hostDirectives: [BrnDialogOverlay],
  selector: '[hlmDialogOverlay],hlm-dialog-overlay',
})
export class HlmDialogOverlay {
  private readonly _classSettable = injectCustomClassSettable({ host: true, optional: true });

  public readonly userClass = input<ClassValue>('', { alias: 'class' });
  protected readonly _computedClass = computed(() => hlm(hlmDialogOverlayClass, this.userClass()));

  constructor() {
    effect(() => {
      const newClass = this._computedClass();
      untracked(() => this._classSettable?.setClassToCustomElement(newClass));
    });
  }
}
