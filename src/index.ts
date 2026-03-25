import { Command } from 'commander';
import pino from 'pino';
import { backtest } from '@/commands/backtest';
import { learn } from '@/commands/learn';
import { optimize } from '@/commands/optimize';
import { predict } from '@/commands/predict';
import type { CliOptions } from '@/types';
import {
  promptExtraOptions,
  promptOptimize,
  promptOutputFormat,
  promptPortfolioAction,
  promptSortOrder,
  promptTickers,
  p,
  pc,
} from '@/ui/prompts';

const logger = pino({
  level: 'info',
  transport: { target: 'pino-pretty' },
});

const program = new Command();

program.name('stock-checker').description('Stock analysis and prediction tool').version('1.0.0');

program
  .command('predict', { isDefault: true })
  .description('Run stock prediction (default)')
  .option('--ticker <list>', 'Comma-separated tickers')
  .option('--slack-webhook <url>', 'Slack webhook URL')
  .option('--sort <order>', 'Sort order: asc or desc', 'asc')
  .option('--portfolio-action <action>', 'Portfolio action: add, remove, list, report')
  .option('--portfolio-ticker <ticker>', 'Portfolio ticker symbol')
  .option('--fundamentals', 'Show fundamentals for ticker')
  .option('--news', 'Show recent news for ticker')
  .option('--options', 'Show options chains for ticker')
  .option('--dividends', 'Show dividend information for ticker')
  .option('--earnings', 'Show earnings data for ticker')
  .option('--format <type>', 'Output format: csv or json', 'csv')
  .action(async (opts) => {
    try {
      const sort =
        (process.env.npm_config_sort as 'asc' | 'desc' | undefined) ?? opts.sort ?? 'asc';

      if (sort !== 'asc' && sort !== 'desc') {
        logger.error("Sort option must be 'asc' or 'desc'");
        process.exit(1);
      }

      const rawTickers = process.env.npm_config_ticker ?? opts.ticker ?? '';
      const isInteractive = !rawTickers && !opts.portfolioAction;

      if (isInteractive) {
        p.intro(pc.bgCyan(pc.black(' stock-checker ')));

        const mode = await p.select({
          message: 'What would you like to do?',
          options: [
            { value: 'predict', label: 'Run stock prediction' },
            { value: 'portfolio', label: 'Manage portfolio' },
          ],
        });

        if (p.isCancel(mode)) {
          p.cancel('Operation cancelled.');
          process.exit(0);
        }

        if (mode === 'portfolio') {
          const { action, ticker } = await promptPortfolioAction();
          const finalOptions: CliOptions = {
            tickers: [],
            sort,
            portfolioAction: action,
            portfolioTicker: ticker,
            format: 'csv',
          };
          await predict(finalOptions);
          p.outro(pc.green('Done!'));
          return;
        }

        const tickers = await promptTickers();
        const sortOrder = await promptSortOrder();
        const format = await promptOutputFormat();
        const extras = await promptExtraOptions();

        const finalOptions: CliOptions = {
          tickers,
          sort: sortOrder,
          format,
          ...extras,
          slackWebhook: process.env.SLACK_WEBHOOK_URL,
        };

        await predict(finalOptions);
        p.outro(pc.green('Done!'));
        return;
      }

      const tickersArray = rawTickers
        ? rawTickers
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean)
        : [];

      const slackWebhook =
        process.env.SLACK_WEBHOOK_URL ??
        (process.env.npm_config_slack_webhook as string | undefined) ??
        opts.slackWebhook;

      let finalTickers: string[];
      if (
        opts.portfolioAction &&
        opts.portfolioAction !== 'list' &&
        opts.portfolioAction !== 'report'
      ) {
        finalTickers = [opts.portfolioTicker ?? ''];
      } else {
        finalTickers = tickersArray;
      }

      const finalOptions: CliOptions = {
        tickers: finalTickers,
        slackWebhook,
        sort,
        portfolioAction: opts.portfolioAction,
        portfolioTicker: opts.portfolioTicker,
        fundamentals: opts.fundamentals,
        news: opts.news,
        options: opts.options,
        dividends: opts.dividends,
        earnings: opts.earnings,
        format: opts.format ?? 'csv',
      };

      await predict(finalOptions);
    } catch (error) {
      logger.error({ err: error }, 'Prediction failed');
      process.exit(1);
    }
  });

program
  .command('learn')
  .description('Run the learning loop')
  .action(async () => {
    try {
      await learn();
    } catch (error) {
      logger.error({ err: error }, 'Learn command failed');
      process.exit(1);
    }
  });

program
  .command('optimize [symbol]')
  .description('Optimize parameters for a symbol (default: TSLA)')
  .option('--trials <number>', 'Number of trials', '200')
  .action(async (symbol, options) => {
    try {
      if (!symbol) {
        p.intro(pc.bgCyan(pc.black(' stock-checker optimize ')));
        const prompted = await promptOptimize();
        await optimize(prompted.symbol, { trials: String(prompted.trials) });
        p.outro(pc.green('Optimization complete!'));
        return;
      }
      await optimize(symbol, options);
    } catch (error) {
      logger.error({ err: error }, 'Optimize command failed');
      process.exit(1);
    }
  });

program
  .command('backtest')
  .description('Run backtest with Pipeline V2 against historical data')
  .action(async () => {
    try {
      await backtest();
    } catch (error) {
      logger.error({ err: error }, 'Backtest failed');
      process.exit(1);
    }
  });

if (require.main === module) {
  program.parseAsync(process.argv).catch((err) => {
    logger.error({ err }, 'Unexpected error');
    process.exit(1);
  });
}
