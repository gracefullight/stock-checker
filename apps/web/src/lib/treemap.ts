export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapTile<T> {
  rect: TreemapRect;
  data: T;
}

interface ScaledItem<T> {
  area: number;
  data: T;
}

/** Worst (most elongated) aspect ratio a row would have at the given side length. */
function worstAspect(row: ScaledItem<unknown>[], side: number): number {
  let sum = 0;
  let max = 0;
  let min = Number.POSITIVE_INFINITY;
  for (const item of row) {
    sum += item.area;
    if (item.area > max) max = item.area;
    if (item.area < min) min = item.area;
  }
  const sideSq = side * side;
  const sumSq = sum * sum;
  return Math.max((sideSq * max) / sumSq, sumSq / (sideSq * min));
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): lays items into `rect` with
 * tile area proportional to `value`, keeping tiles as close to square as
 * possible. Items with non-positive values are dropped. Output order follows
 * descending value.
 */
export function squarify<T>(
  input: Array<{ value: number; data: T }>,
  rect: TreemapRect
): Array<TreemapTile<T>> {
  const items = input.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((sum, i) => sum + i.value, 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return [];

  const scale = (rect.w * rect.h) / total;
  const remaining: ScaledItem<T>[] = items.map((i) => ({ area: i.value * scale, data: i.data }));

  const tiles: Array<TreemapTile<T>> = [];
  let free: TreemapRect = { ...rect };

  const layoutRow = (row: ScaledItem<T>[]) => {
    const rowArea = row.reduce((sum, r) => sum + r.area, 0);
    if (free.w >= free.h) {
      // Vertical strip on the left, tiles stacked top to bottom.
      const stripW = rowArea / free.h;
      let y = free.y;
      for (const item of row) {
        const tileH = item.area / stripW;
        tiles.push({ rect: { x: free.x, y, w: stripW, h: tileH }, data: item.data });
        y += tileH;
      }
      free = { x: free.x + stripW, y: free.y, w: free.w - stripW, h: free.h };
    } else {
      // Horizontal strip on top, tiles laid left to right.
      const stripH = rowArea / free.w;
      let x = free.x;
      for (const item of row) {
        const tileW = item.area / stripH;
        tiles.push({ rect: { x, y: free.y, w: tileW, h: stripH }, data: item.data });
        x += tileW;
      }
      free = { x: free.x, y: free.y + stripH, w: free.w, h: free.h - stripH };
    }
  };

  let row: ScaledItem<T>[] = [];
  for (const item of remaining) {
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worstAspect([...row, item], side) <= worstAspect(row, side)) {
      row.push(item);
    } else {
      layoutRow(row);
      row = [item];
    }
  }
  if (row.length > 0) layoutRow(row);

  return tiles;
}
