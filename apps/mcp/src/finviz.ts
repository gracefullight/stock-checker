import type { McpServer } from '@modelcontextprotocol/server';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@stock-checker/core/src/constants.ts';
import { z } from 'zod/v4';

export const prepareFinvizScreenInput = z.strictObject({
  decision: z.enum(['BUY', 'SELL', 'HOLD', 'ALL']).default('BUY'),
  belowSma50: z
    .boolean()
    .optional()
    .describe(
      'Defaults to the active SC below-SMA50 requirement for BUY; off for other decisions.'
    ),
  marketCap: z.enum(['any', 'over2b']).default('any'),
  averageVolume: z.enum(['any', 'over500k']).default('any'),
  price: z.enum(['any', 'over5']).default('any'),
});

/** Prepare public browser navigation; this does not fetch Finviz or analyze stocks. */
export function prepareFinvizScreen(input: unknown = {}) {
  const options = prepareFinvizScreenInput.parse(input);
  const belowSma50 =
    options.belowSma50 ??
    (options.decision === 'BUY' &&
      DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate.enabled &&
      DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate.requireBelowSma50);
  const filters = [
    ...(options.marketCap === 'over2b' ? ['cap_midover'] : []),
    'ind_stocksonly',
    ...(options.averageVolume === 'over500k' ? ['sh_avgvol_o500'] : []),
    ...(options.price === 'over5' ? ['sh_price_o5'] : []),
    ...(belowSma50 ? ['ta_sma50_pb'] : []),
  ];
  const url = new URL('https://finviz.com/screener');
  url.searchParams.set('v', '411');
  url.searchParams.set('f', filters.join(','));
  return {
    source: 'Finviz' as const,
    decision: options.decision,
    url: url.toString(),
    filters,
    scope: 'US-listed stocks covered by Finviz, excluding funds',
    criteria: {
      priceBelowSma50: belowSma50,
      marketCapUsd: options.marketCap === 'over2b' ? { greaterThan: 2_000_000_000 } : null,
      averageVolumeShares: options.averageVolume === 'over500k' ? { greaterThan: 500_000 } : null,
      priceUsd: options.price === 'over5' ? { greaterThan: 5 } : null,
    },
    secondPass: [
      'Recompute completed-session SMA50, Gaussian trend, market/sector relative strength, ATR percentage, close location, volume participation, confluence and final scores using the existing Stock Checker engine.',
      'Liquidity and VWAP contribute to scores; they are not replaced by a Finviz share-volume threshold. Historical outcome rates and analyst targets are fetched only for selected detail reports.',
    ],
    collection: [
      'Use an available browser MCP such as Aside to open this public URL. This tool itself does not open a browser or fetch Finviz.',
      'Read the displayed filtered Total and selected filters. Collect visible symbols in the Tickers view, following the page links shown by the site. Do not assume a fixed number of rows per page.',
      'Keep the same filters across pages, normalize and deduplicate symbols, and compare the collected count with the displayed filtered Total. Record the capture time.',
      'If a security check, sign-in requirement, or missing page interrupts collection, stop and mark the manifest partial. Do not bypass the restriction or claim complete coverage.',
      'Call create_market_screen with the supplied symbols and Finviz provenance. A supplied CSV exported through an authorized Finviz account is another source for the manifest.',
      'Use get_market_screen for progress and paginated results, and control_market_screen to pause or resume. Pass the same lookbackDays when requesting candidate detail reports.',
    ],
    warnings: [
      'Finviz filters select candidates; the Stock Checker engine final decision determines BUY, SELL, or HOLD.',
      'Finviz price/SMA50 values may use an intraday quote or different adjustments from SC completed-session data. The first pass is an approximation and can omit a ticker the engine would otherwise accept; disable belowSma50 to collect a broader universe.',
      'Market-cap, share-volume and price thresholds are optional candidate limits, not mandatory SC BUY rules. Finviz relative volume uses a different averaging period from SC and is not used as an equivalent gate.',
      'These filters exclude other stocks that might have a Stock Checker BUY signal. This is coverage of the stated Finviz candidate set, not every global stock.',
      'The public browser route requires no Finviz API key. Finviz API/export access is a separate Elite feature; no account, subscription, or API credential is created by this tool.',
      'If the client has no browser MCP, supply a ticker manifest from an authorized browser or CSV instead. No unattended Finviz crawler runs on the stock-checker server.',
    ],
  };
}

export function registerFinvizScreenTool(server: McpServer): void {
  server.registerTool(
    'prepare_finviz_screen',
    {
      title: 'Prepare a Finviz market candidate screen',
      description:
        'Prepare a public Finviz Tickers-view URL for a browser MCP such as Aside. Defaults to BUY candidates: stocks excluding funds, with price below SMA50 matching the current SC pullback requirement. This price gate is off by default for SELL/HOLD/ALL. Optional market-cap, average-volume and price cuts default to any; they are not SC mandatory rules. Finviz quotes may differ from SC completed-session inputs, so the core engine must recheck every candidate. Does not fetch Finviz, open a browser, analyze stocks, or require an API key. Feed the collected manifest to create_market_screen.',
      inputSchema: prepareFinvizScreenInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const plan = prepareFinvizScreen(input);
      return {
        content: [
          {
            type: 'text',
            text: [
              plan.url,
              `Requested final decision: ${plan.decision}.`,
              '',
              ...plan.collection,
              '',
              ...plan.secondPass,
              '',
              ...plan.warnings,
            ].join('\n'),
          },
        ],
        structuredContent: { plan },
      };
    }
  );
}
