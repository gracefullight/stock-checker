import { Command } from 'commander';
import pino from 'pino';
import { learn } from '@/commands/learn';
import { optimize } from '@/commands/optimize';
import { predict } from '@/commands/predict';
import type { CliOptions } from '@/types';

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
      // Logic from src/config.ts to resolve defaults and env vars
      const sort =
        (process.env.npm_config_sort as 'asc' | 'desc' | undefined) ?? opts.sort ?? 'asc';

      if (sort !== 'asc' && sort !== 'desc') {
        logger.error("Sort option must be 'asc' or 'desc'");
        process.exit(1);
      }

      const rawTickers = process.env.npm_config_ticker ?? opts.ticker ?? '';

      if (!rawTickers && !opts.portfolioAction) {
        logger.error(
          'Ticker argument is required. Use --ticker=TSLA,PLTR or --portfolio-action add/remove/list/report'
        );
        process.exit(1);
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

      // If portfolio action is set, use single ticker instead of comma-separated tickers
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
  .option('--trials <number>', 'Number of trials', '50')
  .action(async (symbol, options) => {
    try {
      await optimize(symbol, options);
    } catch (error) {
      logger.error({ err: error }, 'Optimize command failed');
      process.exit(1);
    }
  });

if (require.main === module) {
  program.parseAsync(process.argv).catch((err) => {
    logger.error({ err }, 'Unexpected error');
    process.exit(1);
  });
}
