import { describe, expect, mock, test } from 'bun:test';
import {
  createStockAnalystServer,
  type ScreenGenerator,
  type ScreenNotificationBuilder,
  SERVER_INSTRUCTIONS,
  type WhatsAppNotifier,
} from '@mcp/server.ts';
import { fixtureScreen, fixtureScreenMatch } from '@mcp/test-fixtures/screen.ts';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { buildStockScreenWhatsAppNotification } from '@stock-checker/core/src/utils/stock-screen-alerts.ts';

async function withScreenClient(
  generator: ScreenGenerator,
  check: (client: Client) => Promise<void>,
  notifier: WhatsAppNotifier = mock<WhatsAppNotifier>(async () => ({
    status: 'disabled',
    reason: 'not-configured',
  })),
  builder: ScreenNotificationBuilder = mock(async (screen) =>
    buildStockScreenWhatsAppNotification(screen)
  ),
  configured: () => Promise<boolean> = async () => true
): Promise<void> {
  const server = createStockAnalystServer(
    undefined,
    undefined,
    undefined,
    generator,
    undefined,
    notifier,
    builder,
    configured
  );
  const client = new Client({ name: 'stock-screen-test', version: '1.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await check(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('screen_stocks MCP tool', () => {
  test('preserves BUY candidates, gate reasons, conditional execution and coverage', async () => {
    const screen = fixtureScreen();
    await withScreenClient(
      async () => ({ screen, markdown: '# BUY candidates fixture' }),
      async (client) => {
        const result = await client.callTool({
          name: 'screen_stocks',
          arguments: { tickers: ['AAPL'] },
        });
        expect(result).toMatchObject({
          isError: false,
          content: [{ type: 'text', text: '# BUY candidates fixture' }],
          structuredContent: { screen },
        });
        expect(result).toMatchObject({
          structuredContent: {
            screen: {
              matches: [
                {
                  decision: 'BUY',
                  gates: { trend: { passed: true }, institutional: { passed: true } },
                  execution: { entry: { eligible: true, price: null } },
                },
              ],
              criteria: { timeBudgetMs: 45000 },
            },
          },
        });
      }
    );
  });

  test('treats an analyzed high-score HOLD with failed gates as a normal empty BUY screen', async () => {
    const hold = fixtureScreenMatch('AAPL', 'HOLD');
    const screen = fixtureScreen({
      matches: [],
      excluded: [
        {
          ticker: hold.ticker,
          decision: hold.decision,
          score: hold.score,
          buyScore: hold.buyScore,
          sellScore: hold.sellScore,
          gateReasons: hold.gateReasons,
        },
      ],
      coverage: {
        requested: 1,
        analyzed: 1,
        unavailable: 0,
        matched: 0,
        returned: 0,
        truncated: false,
      },
      decisionCounts: { BUY: 0, SELL: 0, HOLD: 1 },
    });
    await withScreenClient(
      async () => ({ screen, markdown: 'No analyzed ticker has final decision BUY.' }),
      async (client) => {
        const result = await client.callTool({
          name: 'screen_stocks',
          arguments: { tickers: ['AAPL'] },
        });
        expect(result).toMatchObject({ isError: false, structuredContent: { screen } });
        expect(result).toMatchObject({
          structuredContent: {
            screen: { matches: [], excluded: [{ decision: 'HOLD', buyScore: 500 }] },
          },
        });
      }
    );
  });

  test('returns partial coverage without discarding successful candidates', async () => {
    const screen = fixtureScreen({
      status: 'partial',
      universe: { source: 'provided', tickers: ['AAPL', 'BAD'] },
      coverage: {
        requested: 2,
        analyzed: 1,
        unavailable: 1,
        matched: 1,
        returned: 1,
        truncated: false,
      },
      unavailable: [
        {
          ticker: 'BAD',
          reason: '완료된 거래일의 가격 이력을 가져올 수 없습니다.',
          diagnostics: { code: 'history-unavailable', rows: 0 },
        },
      ],
    });
    await withScreenClient(
      async () => ({ screen, markdown: '# Partial screen fixture' }),
      async (client) => {
        expect(
          await client.callTool({ name: 'screen_stocks', arguments: { tickers: ['AAPL', 'BAD'] } })
        ).toMatchObject({ isError: false, structuredContent: { screen } });
      }
    );
  });

  test('marks an entirely unavailable screen as an error while retaining availability evidence', async () => {
    const screen = fixtureScreen({
      status: 'unavailable',
      universe: { source: 'provided', tickers: ['NIVF'] },
      coverage: {
        requested: 1,
        analyzed: 0,
        unavailable: 1,
        matched: 0,
        returned: 0,
        truncated: false,
      },
      decisionCounts: { BUY: 0, SELL: 0, HOLD: 0 },
      matches: [],
      unavailable: [
        {
          ticker: 'NIVF',
          reason: '유효한 ATR 기준 손절·목표 가격을 산정할 수 없습니다.',
          diagnostics: {
            code: 'risk-levels-infeasible',
            rows: 500,
            close: 0.11,
            atr: 0.17364761106778515,
          },
        },
      ],
    });
    await withScreenClient(
      async () => ({ screen, markdown: 'No ticker could be analyzed.' }),
      async (client) => {
        expect(
          await client.callTool({ name: 'screen_stocks', arguments: { tickers: ['NIVF'] } })
        ).toMatchObject({ isError: true, structuredContent: { screen } });
      }
    );
  });

  test('discovers a bounded core-decision screen with explicit optional notification', async () => {
    const generator = mock(async () => {
      throw new Error('Discovery must not analyze tickers');
    });
    await withScreenClient(generator, async (client) => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(10);
      const tool = tools.find((item) => item.name === 'screen_stocks');
      expect(tool).toMatchObject({
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tickers: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              items: { type: 'string', minLength: 1, maxLength: 32 },
            },
            decision: { enum: ['BUY', 'SELL', 'HOLD', 'ALL'], default: 'BUY' },
            lookbackDays: { type: 'integer', minimum: 730, maximum: 3650, default: 730 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            notifyWhatsApp: { type: 'boolean', default: false },
          },
        },
      });
      expect(tool?.description).toContain('after quality gates');
      expect(tool?.description).toContain('20-symbol universe');
      expect(tool?.description).toContain('scores are not win probabilities');
      expect(tool?.description).toContain('fixed environment-configured WhatsApp recipient');
      expect(tool?.description).toContain('default false');
      expect(SERVER_INSTRUCTIONS).toContain('does not search the entire market');
      expect(generator).not.toHaveBeenCalled();
    });
  });

  test.each([{}, { notifyWhatsApp: false }])(
    'does not send an optional notification unless explicitly enabled: %j',
    async (arguments_) => {
      const screen = fixtureScreen();
      const notifier = mock<WhatsAppNotifier>(async () => {
        throw new Error('Notification was not authorized');
      });
      const builder = mock<ScreenNotificationBuilder>(async () => {
        throw new Error('Report enrichment was not authorized');
      });
      await withScreenClient(
        async () => ({ screen, markdown: '# Screen without notification' }),
        async (client) => {
          expect(await client.callTool({ name: 'screen_stocks', arguments: arguments_ })).toEqual({
            isError: false,
            content: [{ type: 'text', text: '# Screen without notification' }],
            structuredContent: { screen },
          });
          expect(notifier).not.toHaveBeenCalled();
          expect(builder).not.toHaveBeenCalled();
        },
        notifier,
        builder
      );
    }
  );

  test.each(['available', 'partial', 'unavailable', 'zero matches'] as const)(
    'sends exactly one requested summary and preserves screen status: %s',
    async (status) => {
      const noMatches = status === 'unavailable' || status === 'zero matches';
      const unavailable = status === 'partial' || status === 'unavailable' ? 1 : 0;
      const screen = fixtureScreen({
        status: status === 'zero matches' ? 'available' : status,
        coverage: {
          requested: status === 'partial' ? 2 : 1,
          analyzed: status === 'unavailable' ? 0 : 1,
          unavailable,
          matched: noMatches ? 0 : 1,
          returned: noMatches ? 0 : 1,
          truncated: false,
        },
        matches: noMatches ? [] : [fixtureScreenMatch('AAPL')],
        unavailable: unavailable ? [{ ticker: 'BAD', reason: 'Fixture missing data' }] : [],
      });
      const notification = { status: 'accepted' as const, messageId: 'wamid.fixture' };
      const notifier = mock<WhatsAppNotifier>(async () => notification);
      await withScreenClient(
        async () => ({ screen, markdown: '# Screen remains available' }),
        async (client) => {
          const result = await client.callTool({
            name: 'screen_stocks',
            arguments: { notifyWhatsApp: true },
          });
          expect(result).toMatchObject({
            isError: screen.status === 'unavailable',
            structuredContent: { screen, notification },
          });
          expect(result.content).toEqual([
            {
              type: 'text',
              text: '# Screen remains available\n\nWhatsApp notification: local gateway accepted the request; delivery is not confirmed.',
            },
          ]);
          expect(notifier).toHaveBeenCalledTimes(1);
          expect(notifier).toHaveBeenCalledWith({
            title: {
              available: '종목 스크리닝 · BUY · 평가 완료 1/1',
              partial: '종목 스크리닝 · BUY · 평가 1/2 · 분석 불가 1',
              unavailable: '종목 스크리닝 · BUY · 평가 0/1 · 분석 불가 1',
              'zero matches': '종목 스크리닝 · BUY · 평가 완료 1/1',
            }[status],
            asOf: `검색 완료 ${screen.generatedAt.slice(0, 16).replace('T', ' ')} UTC`,
            summary: expect.stringContaining(noMatches ? '일치 종목 없음.' : 'AAPL BUY'),
          });
          const payload = notifier.mock.calls[0]?.[0];
          expect(payload?.summary).not.toMatch(/분석|반환|알림|해석 주의|결과 범위|승률/);
          expect(payload?.summary).toContain(
            noMatches ? '일치 종목 없음.' : 'AAPL BUY · 종가일 2026-10-02 · 참고 100.00'
          );
          expect(payload?.summary.length).toBeLessThanOrEqual(700);
        },
        notifier
      );
    }
  );

  test('awaits one enriched report before sending and keeps the original screen snapshot', async () => {
    const screen = fixtureScreen({ criteria: { ...fixtureScreen().criteria, lookbackDays: 2920 } });
    const original = structuredClone(screen);
    const payload = {
      title: 'Enriched stock screen',
      asOf: screen.generatedAt,
      summary: 'Observed win rate 60% (6/10); reasons and analyst targets.',
    };
    const builder = mock<ScreenNotificationBuilder>(async (received) => {
      expect(received).toEqual(original);
      return payload;
    });
    const notifier = mock<WhatsAppNotifier>(async (received) => {
      expect(builder).toHaveBeenCalledTimes(1);
      expect(received).toEqual(payload);
      return { status: 'accepted', messageId: 'fixture' };
    });
    await withScreenClient(
      async () => ({ screen, markdown: '# Saved screen' }),
      async (client) => {
        const result = await client.callTool({
          name: 'screen_stocks',
          arguments: { notifyWhatsApp: true },
        });
        expect(result).toMatchObject({ structuredContent: { screen: original }, isError: false });
        expect(notifier).toHaveBeenCalledTimes(1);
        expect(screen).toEqual(original);
      },
      notifier,
      builder
    );
  });

  test('does not request report data when an explicit notification has no configured sender', async () => {
    const screen = fixtureScreen();
    const builder = mock<ScreenNotificationBuilder>(async () => {
      throw new Error('No report data should be fetched');
    });
    const notifier = mock<WhatsAppNotifier>(async () => ({
      status: 'disabled',
      reason: 'not-configured',
    }));
    await withScreenClient(
      async () => ({ screen, markdown: '# Screen' }),
      async (client) => {
        const result = await client.callTool({
          name: 'screen_stocks',
          arguments: { notifyWhatsApp: true },
        });
        expect(result).toMatchObject({
          structuredContent: {
            screen,
            notification: { status: 'disabled', reason: 'not-configured' },
          },
        });
        expect(builder).not.toHaveBeenCalled();
        expect(notifier).toHaveBeenCalledTimes(1);
      },
      notifier,
      builder,
      async () => false
    );
  });

  test.each([
    { status: 'disabled' as const, reason: 'not-configured' as const },
    { status: 'disabled' as const, reason: 'invalid-configuration' as const },
    { status: 'failed' as const, reason: 'http-error' as const, httpStatus: 401 },
  ])('keeps successful screening when notification is unavailable: %j', async (notification) => {
    const screen = fixtureScreen({ status: 'partial' });
    const notifier = mock<WhatsAppNotifier>(async () => notification);
    await withScreenClient(
      async () => ({ screen, markdown: '# Partial result' }),
      async (client) => {
        const result = await client.callTool({
          name: 'screen_stocks',
          arguments: { notifyWhatsApp: true },
        });
        expect(result).toMatchObject({
          isError: false,
          structuredContent: { screen, notification },
        });
        expect(JSON.stringify(result)).toContain('# Partial result');
        expect(notifier).toHaveBeenCalledTimes(1);
      },
      notifier
    );
  });

  test('sanitizes an unexpected notification rejection without discarding the screen', async () => {
    const screen = fixtureScreen();
    const notifier = mock<WhatsAppNotifier>(async () => {
      throw new Error(
        'https://graph.facebook.com?access_token=private-fixture recipient=821012345678'
      );
    });
    await withScreenClient(
      async () => ({ screen, markdown: '# Successful screen' }),
      async (client) => {
        const result = await client.callTool({
          name: 'screen_stocks',
          arguments: { notifyWhatsApp: true },
        });
        expect(result).toMatchObject({
          isError: false,
          structuredContent: {
            screen,
            notification: { status: 'failed', reason: 'network-error' },
          },
        });
        expect(JSON.stringify(result)).toContain('The screening result is preserved');
        expect(JSON.stringify(result)).not.toMatch(/private-fixture|821012345678|graph\.facebook/);
        expect(notifier).toHaveBeenCalledTimes(1);
      },
      notifier
    );
  });

  test('does not send a notification if screen generation fails', async () => {
    const notifier = mock<WhatsAppNotifier>(async () => ({
      status: 'accepted',
      messageId: 'wamid.fixture',
    }));
    await withScreenClient(
      async () => {
        throw new Error('Fixture generation error');
      },
      async (client) => {
        expect(
          await client.callTool({
            name: 'screen_stocks',
            arguments: { notifyWhatsApp: true },
          })
        ).toMatchObject({ isError: true });
        expect(notifier).not.toHaveBeenCalled();
      },
      notifier
    );
  });

  test('applies optional defaults and sanitizes provider errors', async () => {
    const generator = mock(async () => {
      throw new Error('https://market.example/screen?token=fixture-secret');
    });
    await withScreenClient(generator, async (client) => {
      const result = await client.callTool({ name: 'screen_stocks', arguments: {} });
      expect(generator).toHaveBeenCalledWith({
        tickers: undefined,
        decision: 'BUY',
        lookbackDays: 730,
        limit: 20,
      });
      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).toContain('no screening result was produced');
      expect(JSON.stringify(result)).not.toContain('fixture-secret');
      expect(JSON.stringify(result)).not.toContain('https://');
    });
  });

  test('normalizes supplied symbols while leaving deduplication to the core generator', async () => {
    const generator = mock(async () => {
      throw new Error('Fixture');
    });
    await withScreenClient(generator, async (client) => {
      await client.callTool({
        name: 'screen_stocks',
        arguments: {
          tickers: [' oii ', 'OII', '^gspc', 'brk-b', '005930.ks', 'cl=f'],
          decision: 'ALL',
          lookbackDays: 2920,
          limit: 50,
        },
      });
      expect(generator).toHaveBeenCalledWith({
        tickers: ['OII', 'OII', '^GSPC', 'BRK-B', '005930.KS', 'CL=F'],
        decision: 'ALL',
        lookbackDays: 2920,
        limit: 50,
      });
    });
  });

  test.each([
    { tickers: [] },
    { tickers: Array.from({ length: 51 }, () => 'AAPL') },
    { tickers: 'AAPL,MSFT' },
    { tickers: ['AAPL,MSFT'] },
    { tickers: ['../AAPL'] },
    { tickers: ['AAPL;open'] },
    { tickers: ['AAPL\u0000'] },
    { tickers: [''] },
    { tickers: ['A'.repeat(33)] },
    { tickers: [123] },
    { decision: 'buy' },
    { decision: 'ANY' },
    { decision: null },
    { lookbackDays: 729 },
    { lookbackDays: 3651 },
    { lookbackDays: 730.5 },
    { lookbackDays: '730' },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { limit: '20' },
    { requestUrl: 'https://example.com' },
    { notifyWhatsApp: 'true' },
    { notifyWhatsApp: null },
    { notifyWhatsApp: true, recipient: '+821012345678' },
    { notifyWhatsApp: true, phoneNumber: '+821012345678' },
    { notifyWhatsApp: true, accessToken: 'private-fixture' },
    { notifyWhatsApp: true, WHATSAPP_ACCESS_TOKEN: 'private-fixture' },
  ])('rejects invalid screen input before market-data work: %j', async (arguments_) => {
    const generator = mock(async () => {
      throw new Error('Invalid input must not reach the screen generator');
    });
    const notifier = mock<WhatsAppNotifier>(async () => {
      throw new Error('Invalid input must not notify');
    });
    await withScreenClient(
      generator,
      async (client) => {
        expect(
          await client.callTool({ name: 'screen_stocks', arguments: arguments_ })
        ).toMatchObject({
          isError: true,
        });
        expect(generator).not.toHaveBeenCalled();
        expect(notifier).not.toHaveBeenCalled();
      },
      notifier
    );
  });
});
