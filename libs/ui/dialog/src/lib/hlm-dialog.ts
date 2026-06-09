import { ChangeDetectionStrategy, Component, forwardRef } from '@angular/core';
import { BrnDialog, provideBrnDialogDefaultOptions } from '@spartan-ng/brain/dialog';

import { HlmDialogOverlay } from './hlm-dialog-overlay';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  exportAs: 'hlmDialog',
  imports: [HlmDialogOverlay],
  providers: [
    {
      provide: BrnDialog,
      useExisting: forwardRef(() => HlmDialog),
    },
    provideBrnDialogDefaultOptions({
      // add custom options here
    }),
  ],
  selector: 'hlm-dialog',
  template: `
    <hlm-dialog-overlay />
    <ng-content />
  `,
})
export class HlmDialog extends BrnDialog {}
