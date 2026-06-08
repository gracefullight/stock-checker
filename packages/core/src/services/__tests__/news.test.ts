import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStockNews } from '@/services/news';

const mocks = vi.hoisted(() => {
  const get = vi.fn();
  const create = vi.fn(() => ({
    get,
  }));
  return { get, create };
});

vi.mock('axios', () => ({
  default: {
    create: mocks.create,
  },
}));

describe('news service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStockNews', () => {
    it('should fetch news items', async () => {
      const mockData = `
        <rss><channel><item>
          <title>TSLA beats estimates</title>
          <link>https://example.com/article</link>
          <pubDate>Sat, 24 Jan 2026 00:00:00 GMT</pubDate>
          <description>Strong earnings report drives stock higher</description>
        </item></channel></rss>
      `;

      mocks.get.mockResolvedValue({ data: mockData });

      const result = await getStockNews('TSLA', 5);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('TSLA beats estimates');
      expect(result[0].url).toBe('https://example.com/article');
      expect(result[0].summary).toBe('Strong earnings report drives stock higher');
    });

    it('should return empty array on error', async () => {
      mocks.get.mockRejectedValue(new Error('Network error'));

      const result = await getStockNews('TSLA', 5);

      expect(result).toEqual([]);
    });
  });
});
