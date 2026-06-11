import { describe, expect, it } from 'vitest';
import { DEFAULT_CURRENCY, FX_CURRENCIES, formatInCurrency, formatRate } from '@/lib/currency';

describe('currency', () => {
  it('defaults to KRW and includes it in the supported list', () => {
    expect(DEFAULT_CURRENCY).toBe('KRW');
    expect(FX_CURRENCIES).toContain('KRW');
  });

  it('formats a USD amount in KRW without decimals for large values', () => {
    // 245.30 USD × 1385.5 = 339,863.15 KRW → whole-won display
    expect(formatInCurrency(245.3, 1385.5, 'KRW')).toBe('₩339,863');
  });

  it('keeps decimals for small converted values', () => {
    // 0.5 USD × 0.92 = 0.46 EUR
    expect(formatInCurrency(0.5, 0.92, 'EUR')).toBe('€0.46');
  });

  it('formats large rates with one decimal and small rates with four', () => {
    expect(formatRate(1385.52)).toBe('1,385.5');
    expect(formatRate(0.9234)).toBe('0.9234');
  });
});
