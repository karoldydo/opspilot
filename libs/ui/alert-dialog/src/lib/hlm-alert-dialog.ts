import { ChangeDetectionStrategy, Component, forwardRef } from '@angular/core';
import { BRN_ALERT_DIALOG_DEFAULT_OPTIONS, BrnAlertDialog } from '@spartan-ng/brain/alert-dialog';
import { BrnDialog, provideBrnDialogDefaultOptions } from '@spartan-ng/brain/dialog';

import { HlmAlertDialogOverlay } from './hlm-alert-dialog-overlay';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  exportAs: 'hlmAlertDialog',
  imports: [HlmAlertDialogOverlay],
  providers: [
    {
      provide: BrnDialog,
      useExisting: forwardRef(() => HlmAlertDialog),
    },
    provideBrnDialogDefaultOptions({
      ...BRN_ALERT_DIALOG_DEFAULT_OPTIONS,
    }),
  ],
  selector: 'hlm-alert-dialog',
  template: `
    <hlm-alert-dialog-overlay />
    <ng-content />
  `,
})
export class HlmAlertDialog extends BrnAlertDialog {}
