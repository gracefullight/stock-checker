import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAtTheMoneyOptions, getOptionsChain } from '@/services/options';
import yahooFinance from '@/services/yahoo-finance';

vi.mock('../yahoo-finance', () => ({
  default: {
    options: vi.fn(),
  },
}));

describe('options service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOptionsChain', () => {
    it('should return options chain data for a valid ticker', async () => {
      const mockOptions = {
        expirationDates: [new Date('2024-03-15'), new Date('2024-04-15')],
        strikes: [100, 110, 120],
        quote: {
          regularMarketPrice: 115,
          currency: 'USD',
        },
        options: [
          {
            expirationDate: new Date('2024-03-15'),
            calls: [
              {
                contractSymbol: 'AAPL240315C00100000',
                strike: 110,
                lastPrice: 5.25,
                change: 0.5,
                percentChange: 10.53,
                volume: 1000,
                openInterest: 5000,
                bid: 5.2,
                ask: 5.3,
                impliedVolatility: 0.25,
                inTheMoney: true,
                currency: 'USD',
              },
            ],
            puts: [
              {
                contractSymbol: 'AAPL240315P00120000',
                strike: 120,
                lastPrice: 2.75,
                change: -0.25,
                percentChange: -8.33,
                volume: 500,
                openInterest: 3000,
                bid: 2.7,
                ask: 2.8,
                impliedVolatility: 0.28,
                inTheMoney: false,
                currency: 'USD',
              },
            ],
          },
        ],
      };

      vi.mocked(yahooFinance).options.mockResolvedValue(mockOptions);

      const result = await getOptionsChain('AAPL');

      expect(result).toEqual({
        ticker: 'AAPL',
        expirationDates: [new Date('2024-03-15'), new Date('2024-04-15')],
        strikes: [100, 110, 120],
        options: [
          {
            expirationDate: new Date('2024-03-15'),
            calls: [
              expect.objectContaining({
                strike: 110,
                lastPrice: 5.25,
                volume: 1000,
                openInterest: 5000,
                impliedVolatility: 0.25,
                inTheMoney: true,
              }),
            ],
            puts: [
              expect.objectContaining({
                strike: 120,
                lastPrice: 2.75,
                volume: 500,
                openInterest: 3000,
                impliedVolatility: 0.28,
                inTheMoney: false,
              }),
            ],
          },
        ],
        underlyingPrice: 115,
        currency: 'USD',
      });
    });

    it('should return empty data on API error', async () => {
      vi.mocked(yahooFinance).options.mockRejectedValue(new Error('API Error'));

      const result = await getOptionsChain('INVALID');

      expect(result).toEqual({
        ticker: 'INVALID',
        expirationDates: [],
        strikes: [],
        options: [],
        underlyingPrice: null,
        currency: null,
      });
    });
  });

  describe('getAtTheMoneyOptions', () => {
    it('should return ATM calls and puts', async () => {
      const mockOptions = {
        expirationDates: [new Date('2024-03-15')],
        strikes: [100, 105, 110, 115, 120],
        quote: {
          regularMarketPrice: 115,
          currency: 'USD',
        },
        options: [
          {
            expirationDate: new Date('2024-03-15'),
            calls: [
              {
                contractSymbol: 'AAPL240315C00100000',
                strike: 110,
                lastPrice: 5.25,
                change: 0.5,
                percentChange: 10.53,
                volume: 1000,
                openInterest: 5000,
                bid: 5.2,
                ask: 5.3,
                impliedVolatility: 0.25,
                inTheMoney: true,
                currency: 'USD',
              },
              {
                contractSymbol: 'AAPL240315C00115000',
                strike: 115,
                lastPrice: 2.5,
                change: -0.1,
                percentChange: -3.85,
                volume: 800,
                openInterest: 4000,
                bid: 2.45,
                ask: 2.55,
                impliedVolatility: 0.26,
                inTheMoney: true,
                currency: 'USD',
              },
            ],
            puts: [
              {
                contractSymbol: 'AAPL240315P00120000',
                strike: 120,
                lastPrice: 2.75,
                change: -0.25,
                percentChange: -8.33,
                volume: 500,
                openInterest: 3000,
                bid: 2.7,
                ask: 2.8,
                impliedVolatility: 0.28,
                inTheMoney: false,
                currency: 'USD',
              },
            ],
          },
        ],
      };

      vi.mocked(yahooFinance).options.mockResolvedValue(mockOptions);

      const result = await getAtTheMoneyOptions('AAPL', 10);

      expect(result.underlyingPrice).toBe(115);
      expect(result.calls).toHaveLength(2);
      expect(result.calls[0].strike).toBe(110);
      expect(result.puts).toHaveLength(1);
      expect(result.puts[0].strike).toBe(120);
    });

    it('should return empty arrays when underlying price is null', async () => {
      const mockOptions = {
        expirationDates: [],
        strikes: [],
        quote: {
          regularMarketPrice: null,
          currency: null,
        },
        options: [],
      };

      vi.mocked(yahooFinance).options.mockResolvedValue(mockOptions);

      const result = await getAtTheMoneyOptions('AAPL');

      expect(result).toEqual({
        calls: [],
        puts: [],
        underlyingPrice: null,
      });
    });
  });
});
