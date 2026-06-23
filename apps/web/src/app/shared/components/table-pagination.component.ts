import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmPaginationImports } from '@spartan-ng/helm/pagination';

// a page slot in the footer pager: a concrete page number or a collapsed gap.
type PageToken = 'ellipsis' | number;

// the threshold below which every page is shown; above it the list windows around the
// current page with ellipses, mirroring the helm pager's own layout.
const MAX_INLINE_PAGES = 7;

// builds the windowed list of page slots: always the first and last page, the current
// page and its neighbours, and an ellipsis wherever a gap is collapsed.
function buildPageTokens(current: number, count: number): PageToken[] {
  if (count <= MAX_INLINE_PAGES) {
    return Array.from({ length: count }, (_, index) => index + 1);
  }
  const tokens: PageToken[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(count - 1, current + 1);
  if (start > 2) {
    tokens.push('ellipsis');
  }
  for (let page = start; page <= end; page += 1) {
    tokens.push(page);
  }
  if (end < count - 1) {
    tokens.push('ellipsis');
  }
  tokens.push(count);
  return tokens;
}

// a thin presentational footer bound to a clientTable's page/pageCount/rangeLabel surface,
// so the pagination chrome is written once and reused across all the list screens. it is
// click-driven (emits pageChange) rather than route-driven — the table state lives in
// signals, not the url — so it composes the helm pagination layout directives with plain
// hlmBtn controls instead of the router-linked pagination links.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...HlmPaginationImports, HlmButton],
  selector: 'app-table-pagination',
  templateUrl: './table-pagination.component.html',
})
export class TablePaginationComponent {
  readonly page = input.required<number>();

  readonly pageCount = input.required<number>();

  readonly rangeLabel = input.required<string>();

  readonly pageChange = output<number>();

  protected readonly tokens = computed<PageToken[]>(() => buildPageTokens(this.page(), this.pageCount()));

  // emits a clamped target page, ignoring no-op moves (already on the page / out of range).
  protected go(target: number): void {
    const clamped = Math.min(Math.max(1, target), this.pageCount());
    if (clamped !== this.page()) {
      this.pageChange.emit(clamped);
    }
  }
}
