import { describe, expect, it, vi } from 'vitest';

import { facetQuery } from './facet-query';

interface ProbeQuery {
  language?: string;
  search?: string;
  page: number;
  pageSize: number;
}

function probe() {
  const query = vi.fn(async (_q: ProbeQuery) => ({ rows: ['row'], total: 1 }));
  return { query, queryFn: facetQuery(query, 'language') };
}

describe('facetQuery', () => {
  it('omits the facet key for a null filter and the search for an empty one', async () => {
    const { query, queryFn } = probe();

    await queryFn({ filter: null, search: '', page: 1, pageSize: 24 });

    const [sent] = query.mock.calls[0];
    expect(sent.language).toBeUndefined();
    expect(sent.search).toBeUndefined();
  });

  it('maps the filter to the platform facet key and passes values through', async () => {
    const { query, queryFn } = probe();

    await queryFn({ filter: 'Rust', search: 'cli', page: 3, pageSize: 10 });

    expect(query).toHaveBeenCalledWith({ language: 'Rust', search: 'cli', page: 3, pageSize: 10 });
  });

  it('returns the platform query result unchanged', async () => {
    const { queryFn } = probe();

    await expect(queryFn({ filter: null, search: '', page: 1, pageSize: 1 })).resolves.toEqual({
      rows: ['row'],
      total: 1,
    });
  });
});
