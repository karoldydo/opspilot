import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { type ClientTableSort } from '@app/shared/client-table';
import { NgIcon } from '@ng-icons/core';

import { SortHeaderComponent } from './sort-header.component';

// the rendered chevron's icon name — the only signal of the active sort direction.
function iconName(fixture: ReturnType<typeof setup>): string | undefined {
  return fixture.debugElement.query(By.directive(NgIcon))?.componentInstance.name();
}

function setup(sort: ClientTableSort | null, opts: { iconOnly?: boolean } = {}) {
  const fixture = TestBed.createComponent(SortHeaderComponent);
  fixture.componentRef.setInput('key', 'name');
  fixture.componentRef.setInput('label', 'name');
  fixture.componentRef.setInput('sort', sort);
  if (opts.iconOnly !== undefined) {
    fixture.componentRef.setInput('iconOnly', opts.iconOnly);
  }
  fixture.detectChanges();
  return fixture;
}

describe('SortHeaderComponent', () => {
  it('renders the label and a button', () => {
    const fixture = setup(null);

    const button = fixture.nativeElement.querySelector('button');
    expect(button).toBeTruthy();
    expect(button.textContent?.trim()).toBe('name');
  });

  it('emits the sort key when the header is clicked', () => {
    const fixture = setup(null);
    let emitted: string | undefined;
    fixture.componentInstance.sortChange.subscribe((key) => (emitted = key));

    fixture.nativeElement.querySelector('button').click();

    expect(emitted).toBe('name');
  });

  it('shows the up chevron when this column is sorted ascending', () => {
    const fixture = setup({ dir: 'asc', key: 'name' });
    expect(iconName(fixture)).toBe('lucideChevronUp');
  });

  it('shows the down chevron when this column is sorted descending', () => {
    const fixture = setup({ dir: 'desc', key: 'name' });
    expect(iconName(fixture)).toBe('lucideChevronDown');
  });

  it('shows the neutral up-down chevron when another column is the active sort', () => {
    const fixture = setup({ dir: 'asc', key: 'other' });
    expect(iconName(fixture)).toBe('lucideChevronsUpDown');
  });

  it('hides the label visually but keeps it for screen readers when iconOnly', () => {
    const fixture = setup(null, { iconOnly: true });

    const srOnly = fixture.nativeElement.querySelector('.sr-only');
    expect(srOnly?.textContent?.trim()).toBe('sort by name');
  });
});
