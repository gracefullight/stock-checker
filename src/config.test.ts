import { describe, it, expect } from 'vitest';
import { parseOptions } from './config';

describe('parseOptions', () => {
  it('should parse ticker option', () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'index.ts', '--ticker=TSLA,PLTR'];
    const result = parseOptions();
    process.argv = originalArgv;

    expect(result.tickers).toEqual(['TSLA', 'PLTR']);
  });

  it('should default sort to asc', () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'index.ts', '--ticker=TSLA'];
    const result = parseOptions();
    process.argv = originalArgv;

    expect(result.sort).toBe('asc');
  });

  it('should throw error when ticker is missing', () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'index.ts'];

    expect(() => parseOptions()).toThrow();
    process.argv = originalArgv;
  });
});
