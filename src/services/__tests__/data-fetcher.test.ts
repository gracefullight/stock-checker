import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFearGreedIndex } from '@/services/data-fetcher';

const mocks = vi.hoisted(() => {
  const get = vi.fn();
  const create = vi.fn(() => ({
    get,
    interceptors: {
      response: { use: vi.fn() },
    },
  }));
  return { get, create };
});

vi.mock('axios', () => ({
  default: {
    create: mocks.create,
    get: mocks.get,
  },
}));

describe('data-fetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getFearGreedIndex', () => {
    it('should return fear greed value on successful fetch', async () => {
      mocks.get.mockResolvedValue({
        data: { data: [{ value: 42 }] },
      });

      const result = await getFearGreedIndex();
      expect(result).toBe(42);
    });

    it('should return null on error', async () => {
      mocks.get.mockRejectedValue(new Error('Network error'));

      const result = await getFearGreedIndex();
      expect(result).toBeNull();
    });
  });
});
