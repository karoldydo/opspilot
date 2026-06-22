import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { type ClickableVariant } from './clickable-classes';
import { ClickableDirective } from './clickable.directive';

@Component({
  imports: [ClickableDirective],
  template: `<button class="border-op-hairline bg-op-cream text-op-body" [variant]="variant" appClickable>x</button>`,
})
class HostComponent {
  variant: ClickableVariant = 'secondary';
}

async function render(variant: ClickableVariant): Promise<HTMLButtonElement> {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.variant = variant;
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
}

const SHARED_BASE = ['cursor-pointer', 'transition-colors', 'focus-visible:ring-1', 'focus-visible:outline-none'];

describe('ClickableDirective', () => {
  it('applies the shared surface affordance plus the ink ring for the secondary variant', async () => {
    const button = await render('secondary');

    for (const token of SHARED_BASE) {
      expect(button.classList.contains(token)).toBe(true);
    }
    expect(button.classList.contains('hover:bg-op-surface-card')).toBe(true);
    expect(button.classList.contains('active:bg-op-surface-soft')).toBe(true);
    expect(button.classList.contains('focus-visible:ring-op-ink')).toBe(true);
    expect(button.classList.contains('hover:border-op-hairline-strong')).toBe(true);
  });

  it('keeps the host static color classes instead of clobbering them', async () => {
    const button = await render('secondary');

    expect(button.classList.contains('border-op-hairline')).toBe(true);
    expect(button.classList.contains('bg-op-cream')).toBe(true);
    expect(button.classList.contains('text-op-body')).toBe(true);
  });

  it('makes the primary variant disable-aware', async () => {
    const button = await render('primary');

    expect(button.classList.contains('focus-visible:ring-op-ink')).toBe(true);
    expect(button.classList.contains('disabled:cursor-not-allowed')).toBe(true);
    expect(button.classList.contains('disabled:opacity-60')).toBe(true);
  });

  it('swaps the focus ring to danger for the danger variant', async () => {
    const button = await render('danger');

    expect(button.classList.contains('focus-visible:ring-op-danger')).toBe(true);
    expect(button.classList.contains('focus-visible:ring-op-ink')).toBe(false);
  });

  it('uses a link treatment (underline, no card-fill hover) for the link variant', async () => {
    const button = await render('link');

    expect(button.classList.contains('hover:underline')).toBe(true);
    expect(button.classList.contains('underline-offset-4')).toBe(true);
    expect(button.classList.contains('hover:bg-op-surface-card')).toBe(false);
  });

  it('does not apply the disabled utilities to non-primary variants by default', async () => {
    const button = await render('secondary');

    expect(button.classList.contains('disabled:cursor-not-allowed')).toBe(false);
    expect(button.classList.contains('disabled:opacity-60')).toBe(false);
  });

  it('keeps dark solid buttons in the dark range (no light surface hover) with a cream ring', async () => {
    const button = await render('solid');

    expect(button.classList.contains('hover:bg-op-charcoal')).toBe(true);
    expect(button.classList.contains('active:bg-op-ink-deep')).toBe(true);
    expect(button.classList.contains('focus-visible:ring-op-cream')).toBe(true);
    // a light card-fill hover would wash out the cream text — it must not be applied.
    expect(button.classList.contains('hover:bg-op-surface-card')).toBe(false);
    // submit/confirm controls are disable-aware.
    expect(button.classList.contains('disabled:cursor-not-allowed')).toBe(true);
  });

  it('keeps dark destructive confirm buttons dark with a danger ring', async () => {
    const button = await render('danger-solid');

    expect(button.classList.contains('hover:bg-op-charcoal')).toBe(true);
    expect(button.classList.contains('focus-visible:ring-op-danger')).toBe(true);
    expect(button.classList.contains('hover:bg-op-surface-card')).toBe(false);
    expect(button.classList.contains('focus-visible:ring-op-cream')).toBe(false);
  });
});
