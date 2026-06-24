import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { type ClientTableSort } from '@app/shared/client-table';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideChevronsUpDown, lucideChevronUp } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';

// a clickable column header for the shared clientTable: one ghost hlmBtn carrying the shared
// uppercase/tracking typography plus a sort-direction chevron (up/down on the active column, a
// neutral up-down affordance otherwise). replaces the 12 duplicated <button …uppercase> headers
// across the list screens. behaviourless beyond emitting (sortChange); the caller drives the table.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, NgIcon],
  providers: [provideIcons({ lucideChevronDown, lucideChevronsUpDown, lucideChevronUp })],
  selector: 'app-sort-header',
  template: `
    <button type="button" [size]="buttonSize()" (click)="sortChange.emit(key())" hlmBtn variant="ghost">
      <span class="text-op-mute flex items-center gap-1 text-[10px] font-bold tracking-[0.5px] uppercase">
        @if (iconOnly()) {
          <span class="sr-only">sort by {{ label() }}</span>
        } @else {
          {{ label() }}
        }
        <ng-icon class="text-[13px]" aria-hidden="true" [name]="icon()" />
      </span>
    </button>
  `,
})
export class SortHeaderComponent {
  // the clientTable sort key this header drives.
  readonly key = input.required<string>();

  // the visible column label (also the sr-only label when iconOnly).
  readonly label = input.required<string>();

  // the table's current single-column sort (null when unsorted).
  readonly sort = input.required<ClientTableSort | null>();

  // hide the label visually (icon-only header, e.g. the status-dot column) while keeping it for a11y.
  readonly iconOnly = input(false);

  // emits the sort key when activated; the caller toggles its table sort.
  readonly sortChange = output<string>();

  // this column is the active sort target.
  protected readonly active = computed(() => this.sort()?.key === this.key());

  // an icon-only header sizes square; a labelled one uses the compact text size.
  protected readonly buttonSize = computed<'icon-sm' | 'sm'>(() => (this.iconOnly() ? 'icon-sm' : 'sm'));

  // sort-direction chevron: up/down on the active column, a neutral up-down affordance otherwise.
  protected readonly icon = computed(() => {
    if (!this.active()) {
      return 'lucideChevronsUpDown';
    }
    return this.sort()?.dir === 'asc' ? 'lucideChevronUp' : 'lucideChevronDown';
  });
}
