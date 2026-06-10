import { describe, expect, it } from 'vitest';
import { squarify, type TreemapRect } from '@/lib/treemap';

const RECT: TreemapRect = { x: 0, y: 0, w: 100, h: 60 };

describe('squarify', () => {
  it('produces tile areas proportional to values', () => {
    const tiles = squarify(
      [
        { value: 6, data: 'a' },
        { value: 3, data: 'b' },
        { value: 1, data: 'c' },
      ],
      RECT
    );

    const total = RECT.w * RECT.h;
    const area = (d: string) => {
      const t = tiles.find((x) => x.data === d);
      if (!t) throw new Error(`missing tile ${d}`);
      return t.rect.w * t.rect.h;
    };

    expect(area('a')).toBeCloseTo((6 / 10) * total, 5);
    expect(area('b')).toBeCloseTo((3 / 10) * total, 5);
    expect(area('c')).toBeCloseTo((1 / 10) * total, 5);
  });

  it('keeps every tile inside the bounding rect', () => {
    const tiles = squarify(
      Array.from({ length: 12 }, (_, i) => ({ value: i + 1, data: i })),
      RECT
    );

    expect(tiles).toHaveLength(12);
    for (const { rect } of tiles) {
      expect(rect.x).toBeGreaterThanOrEqual(RECT.x - 1e-6);
      expect(rect.y).toBeGreaterThanOrEqual(RECT.y - 1e-6);
      expect(rect.x + rect.w).toBeLessThanOrEqual(RECT.x + RECT.w + 1e-6);
      expect(rect.y + rect.h).toBeLessThanOrEqual(RECT.y + RECT.h + 1e-6);
    }
  });

  it('fills the rect completely', () => {
    const tiles = squarify(
      [
        { value: 5, data: 'a' },
        { value: 4, data: 'b' },
        { value: 3, data: 'c' },
        { value: 2, data: 'd' },
      ],
      RECT
    );

    const sum = tiles.reduce((s, t) => s + t.rect.w * t.rect.h, 0);
    expect(sum).toBeCloseTo(RECT.w * RECT.h, 5);
  });

  it('drops non-positive values and handles empty input', () => {
    expect(squarify([], RECT)).toEqual([]);
    expect(squarify([{ value: 0, data: 'zero' }], RECT)).toEqual([]);

    const tiles = squarify(
      [
        { value: 2, data: 'keep' },
        { value: -1, data: 'drop' },
      ],
      RECT
    );
    expect(tiles.map((t) => t.data)).toEqual(['keep']);
  });

  it('respects a non-origin offset rect', () => {
    const offset: TreemapRect = { x: 10, y: 20, w: 50, h: 30 };
    const tiles = squarify(
      [
        { value: 1, data: 'a' },
        { value: 1, data: 'b' },
      ],
      offset
    );
    for (const { rect } of tiles) {
      expect(rect.x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(rect.y).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(rect.x + rect.w).toBeLessThanOrEqual(60 + 1e-6);
      expect(rect.y + rect.h).toBeLessThanOrEqual(50 + 1e-6);
    }
  });
});
