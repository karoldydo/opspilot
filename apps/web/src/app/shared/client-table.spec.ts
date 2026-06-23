import { signal } from '@angular/core';

import { clientTable } from './client-table';

interface Row {
  name: string;
  rank: number;
  scope: string;
}

const rows: Row[] = [
  { name: 'alpha', rank: 2, scope: 'global' },
  { name: 'bravo', rank: 1, scope: 'host' },
  { name: 'charlie', rank: 3, scope: 'global' },
];

function setup(extra: Partial<Parameters<typeof clientTable<Row>>[0]> = {}) {
  const source = signal<Row[]>(rows);
  const table = clientTable<Row>({
    filters: { scope: (row, value) => row.scope === value },
    searchText: (row) => row.name,
    sorters: { name: (row) => row.name, rank: (row) => row.rank },
    source,
    ...extra,
  });
  return { source, table };
}

describe('clientTable', () => {
  it('narrows rows by free-text query', () => {
    const { table } = setup();
    table.setQuery('bra');
    expect(table.pageRows().map((r) => r.name)).toEqual(['bravo']);
    expect(table.total()).toBe(1);
  });

  it('treats an "all" filter value as off and applies a concrete value', () => {
    const { table } = setup();
    table.setFilter('scope', 'all');
    expect(table.total()).toBe(3);
    table.setFilter('scope', 'global');
    expect(table.pageRows().map((r) => r.name)).toEqual(['alpha', 'charlie']);
  });

  it('toggles sort asc → desc → asc on the same key', () => {
    const { table } = setup();
    table.toggleSort('name');
    expect(table.sort()).toEqual({ dir: 'asc', key: 'name' });
    expect(table.pageRows().map((r) => r.name)).toEqual(['alpha', 'bravo', 'charlie']);
    table.toggleSort('name');
    expect(table.sort()).toEqual({ dir: 'desc', key: 'name' });
    expect(table.pageRows().map((r) => r.name)).toEqual(['charlie', 'bravo', 'alpha']);
    table.toggleSort('name');
    expect(table.sort()).toEqual({ dir: 'asc', key: 'name' });
  });

  it('honours initialSort and sorts numerically by the rank sorter', () => {
    const { table } = setup({ initialSort: { dir: 'asc', key: 'rank' } });
    expect(table.pageRows().map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('resets the page to 1 on query, filter, or sort change', () => {
    const { source, table } = setup({ pageSize: 1 });
    table.setPage(3);
    expect(table.page()).toBe(3);
    table.setQuery('');
    expect(table.page()).toBe(1);

    table.setPage(3);
    table.setFilter('scope', 'all');
    expect(table.page()).toBe(1);

    table.setPage(3);
    table.toggleSort('name');
    expect(table.page()).toBe(1);

    // sanity: pagination still slices to one row per page.
    expect(source().length).toBe(3);
    expect(table.pageRows().length).toBe(1);
  });

  it('paginates and reports an accurate range label', () => {
    const { table } = setup({ pageSize: 2 });
    expect(table.pageCount()).toBe(2);
    expect(table.rangeLabel()).toBe('showing 1–2 of 3');
    table.setPage(2);
    expect(table.pageRows().length).toBe(1);
    expect(table.rangeLabel()).toBe('showing 3–3 of 3');
  });

  it('handles an empty source: page count ≥ 1 and a zeroed range label', () => {
    const source = signal<Row[]>([]);
    const table = clientTable<Row>({
      searchText: (row) => row.name,
      sorters: { name: (row) => row.name },
      source,
    });
    expect(table.total()).toBe(0);
    expect(table.pageCount()).toBe(1);
    expect(table.pageRows()).toEqual([]);
    expect(table.rangeLabel()).toBe('showing 0–0 of 0');
  });

  it('tracks source signal changes', () => {
    const { source, table } = setup();
    source.set([{ name: 'delta', rank: 9, scope: 'global' }]);
    expect(table.total()).toBe(1);
    expect(table.pageRows().map((r) => r.name)).toEqual(['delta']);
  });
});
