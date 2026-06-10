import { AxiosError } from 'axios';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { LOG_REDACT_PATHS } from '@/services/data-fetcher';

describe('LOG_REDACT_PATHS', () => {
  it('censors the Tiingo token inside logged axios errors', () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' } },
      {
        write: (line: string) => {
          lines.push(line);
        },
      }
    );

    const error = new AxiosError(
      'Request failed with status code 429',
      'ERR_BAD_REQUEST',
      // Partial config is enough for axios error serialization.
      {
        url: '/tiingo/daily/TSLA/prices',
        params: { startDate: '2024-06-10', token: 'super-secret-token' },
      } as never
    );

    logger.error({ error, symbol: 'TSLA' }, 'Tiingo fallback failed');

    const output = lines.join('');
    expect(output).not.toContain('super-secret-token');
    expect(output).toContain('[REDACTED]');
  });
});
