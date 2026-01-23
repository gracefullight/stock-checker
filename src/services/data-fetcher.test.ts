import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { getHistoricalPrices, getFearGreedIndex } from './data-fetcher';

describe('data-fetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getFearGreedIndex', () => {
    it('should return fear greed value on successful fetch', async () => {
      vi.mock('axios');
      vi.spyOn(axios, 'get').mockResolvedValue({
        data: { data: [{ value: 42 }] }
      });

      const result = await getFearGreedIndex();
      expect(result).toBe(42);
    });

    it('should return null on error', async () => {
      vi.mock('axios');
      vi.spyOn(axios, 'get').mockRejectedValue(new Error('Network error'));

      const result = await getFearGreedIndex();
      expect(result).toBeNull();
    });
  });
});
