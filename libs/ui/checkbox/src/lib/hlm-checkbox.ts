import type { BooleanInput } from '@angular/cdk/coercion';
import type { ChangeFn, TouchFn } from '@spartan-ng/brain/forms';
import type { ClassValue } from 'clsx';

import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  linkedSignal,
  model,
  output,
  viewChild,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck } from '@ng-icons/lucide';
import { BrnCheckbox } from '@spartan-ng/brain/checkbox';
import { BrnFieldControlDescribedBy } from '@spartan-ng/brain/field';

import { HlmIcon } from '../../../icon/src/index';
import { hlm } from '../../../utils/src/lib/hlm';

export const HLM_CHECKBOX_VALUE_ACCESSOR = {
  multi: true,
  provide: NG_VALUE_ACCESSOR,
  useExisting: forwardRef(() => HlmCheckbox),
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-label]': 'null',
    '[attr.aria-labelledby]': 'null',
    '[attr.data-disabled]': '_disabled() ? "" : null',
    class: 'contents peer',
    'data-slot': 'checkbox',
  },
  hostDirectives: [BrnFieldControlDescribedBy],
  imports: [BrnCheckbox, NgIcon, HlmIcon],
  providers: [HLM_CHECKBOX_VALUE_ACCESSOR],
  selector: 'hlm-checkbox',
  template: `
    <brn-checkbox
      [(indeterminate)]="indeterminate"
      [aria-describedby]="ariaDescribedby()"
      [aria-label]="ariaLabel()"
      [aria-labelledby]="ariaLabelledby()"
      [checked]="checked()"
      [class]="_computedClass()"
      [disabled]="_disabled()"
      [forceInvalid]="forceInvalid()"
      [id]="inputId()"
      [name]="name()"
      [required]="required()"
      (checkedChange)="_handleChange($event)"
      (touched)="_onTouched?.()"
    >
      @if (checked() || indeterminate()) {
        <span class="flex items-center justify-center text-current transition-none">
          <ng-icon name="lucideCheck" hlm size="14px" />
        </span>
      }
    </brn-checkbox>
  `,
  viewProviders: [provideIcons({ lucideCheck })],
})
export class HlmCheckbox implements ControlValueAccessor {
  public readonly userClass = input<ClassValue>('', { alias: 'class' });

  protected readonly _computedClass = computed(() =>
    hlm(
      'border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 peer size-4 shrink-0 cursor-default rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
      this.userClass(),
      this._disabled() ? 'cursor-not-allowed opacity-50' : '',
      this._errorStateClass()
    )
  );

  /** Used to set the id on the underlying brn element. */
  public readonly inputId = input<null | string>(null);

  /** Used to set the aria-label attribute on the underlying brn element. */
  public readonly ariaLabel = input<null | string>(null, { alias: 'aria-label' });

  /** Used to set the aria-labelledby attribute on the underlying brn element. */
  public readonly ariaLabelledby = input<null | string>(null, { alias: 'aria-labelledby' });

  /** Used to set the aria-describedby attribute on the underlying brn element. */
  public readonly ariaDescribedby = input<null | string>(null, { alias: 'aria-describedby' });

  /** The checked state of the checkbox. */
  public readonly checked = model<boolean>(false);

  /** Emits when checked state changes. */
  public readonly checkedChange = output<boolean>();

  /**
   * The indeterminate state of the checkbox.
   * For example, a "select all/deselect all" checkbox may be in the indeterminate state when some but not all of its sub-controls are checked.
   */
  public readonly indeterminate = model<boolean>(false);

  /** The name attribute of the checkbox. */
  public readonly name = input<null | string>(null);

  /** Whether the checkbox is required. */
  public readonly required = input<boolean, BooleanInput>(false, { transform: booleanAttribute });

  /** Whether the checkbox is disabled. */
  public readonly disabled = input<boolean, BooleanInput>(false, { transform: booleanAttribute });

  /** Whether to force the checkbox into an invalid state. */
  public readonly forceInvalid = input<boolean, BooleanInput>(false, { transform: booleanAttribute });

  protected readonly _disabled = linkedSignal(this.disabled);

  private readonly _brnCheckbox = viewChild.required(BrnCheckbox);

  private readonly _spartanInvalid = computed(() => this.forceInvalid() || this._brnCheckbox().spartanInvalid?.());
  protected readonly _errorStateClass = computed(() =>
    this._spartanInvalid()
      ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40'
      : ''
  );

  protected _onChange?: ChangeFn<boolean>;
  protected _onTouched?: TouchFn;

  protected _handleChange(value: boolean): void {
    if (this._disabled()) return;
    this.checked.set(value);
    this.checkedChange.emit(value);
    this._onChange?.(value);
  }

  /** CONTROL VALUE ACCESSOR */
  writeValue(value: boolean): void {
    this.checked.set(value);
  }

  registerOnChange(fn: ChangeFn<boolean>): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: TouchFn): void {
    this._onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this._disabled.set(isDisabled);
  }
}
