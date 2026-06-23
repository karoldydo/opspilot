import { computed, type Signal, signal } from '@angular/core';

// the reactive surface a clientTable exposes — feature components and the shared
// pagination footer type their instance against this.
export type ClientTable<T> = ReturnType<typeof clientTable<T>>;

export interface ClientTableOptions<T> {
  // key -> predicate; a filter is off when its value is unset, '' or 'all'.
  filters?: Record<string, (row: T, value: string) => boolean>;
  initialSort?: ClientTableSort;
  // rows per page; defaults to 10.
  pageSize?: number;
  // concatenated haystack for the free-text query (already lowercased internally).
  searchText: (row: T) => string;
  // key -> comparable; the active sort key selects one.
  sorters: Record<string, (row: T) => number | string>;
  // the loaded rows (a signal so the table tracks store reloads).
  source: Signal<T[]>;
}

// one direction of a single-column sort.
export interface ClientTableSort {
  dir: 'asc' | 'desc';
  key: string;
}

// a pure, no-DI signal helper that owns search · column filters · single-column sort ·
// client pagination over an already-loaded collection, so all the list screens behave
// identically. uses only signal()/computed() (no effect()), so it works outside an
// injection context and is unit-testable without TestBed. the load-bearing invariant:
// the page resets to 1 whenever the query, any filter, or the sort changes.
export function clientTable<T>(opts: ClientTableOptions<T>) {
  const pageSize = opts.pageSize ?? 10;

  const query = signal('');
  const filterValues = signal<Record<string, string>>({});
  const sort = signal<ClientTableSort | null>(opts.initialSort ?? null);
  const page = signal(1);

  function setQuery(value: string): void {
    query.set(value);
    page.set(1);
  }

  function setFilter(key: string, value: string): void {
    filterValues.update((values) => ({ ...values, [key]: value }));
    page.set(1);
  }

  // cycles asc → desc → asc on the same key; a new key starts at asc. either way the
  // page returns to 1.
  function toggleSort(key: string): void {
    sort.update((current) =>
      current && current.key === key ? { dir: current.dir === 'asc' ? 'desc' : 'asc', key } : { dir: 'asc', key }
    );
    page.set(1);
  }

  function setPage(value: number): void {
    page.set(value);
  }

  // free-text search ∧ every active column filter. an empty query and an 'all'/unset
  // filter value are both no-ops.
  const filtered = computed(() => {
    const q = query().trim().toLowerCase();
    const activeFilters = filterValues();
    return opts.source().filter((row) => {
      if (q && !opts.searchText(row).toLowerCase().includes(q)) {
        return false;
      }
      for (const [key, value] of Object.entries(activeFilters)) {
        const predicate = opts.filters?.[key];
        if (value && value !== 'all' && predicate && !predicate(row, value)) {
          return false;
        }
      }
      return true;
    });
  });

  // filtered rows ordered by the active sorter; copies before sorting so the source
  // array is never mutated in place.
  const sorted = computed(() => {
    const current = sort();
    const rows = filtered();
    const sorter = current ? opts.sorters[current.key] : undefined;
    if (!current || !sorter) {
      return rows;
    }
    const direction = current.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sorter(a);
      const bv = sorter(b);
      if (av < bv) {
        return -direction;
      }
      if (av > bv) {
        return direction;
      }
      return 0;
    });
  });

  const total = computed(() => filtered().length);
  // always at least one page so an empty table still renders page 1.
  const pageCount = computed(() => Math.max(1, Math.ceil(total() / pageSize)));
  // clamp the raw page into range — the filtered total can shrink below it.
  const currentPage = computed(() => Math.min(page(), pageCount()));

  const pageRows = computed(() => {
    const start = (currentPage() - 1) * pageSize;
    return sorted().slice(start, start + pageSize);
  });

  // "showing X–Y of N" (en dash), or "showing 0–0 of 0" for an empty table.
  const rangeLabel = computed(() => {
    const count = total();
    if (count === 0) {
      return 'showing 0–0 of 0';
    }
    const start = (currentPage() - 1) * pageSize + 1;
    const end = Math.min(currentPage() * pageSize, count);
    return `showing ${start}–${end} of ${count}`;
  });

  return {
    filterValues: filterValues.asReadonly(),
    page: currentPage,
    pageCount,
    pageRows,
    query: query.asReadonly(),
    rangeLabel,
    setFilter,
    setPage,
    setQuery,
    sort: sort.asReadonly(),
    toggleSort,
    total,
  };
}
