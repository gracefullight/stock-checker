import * as p from '@clack/prompts';
import pc from 'picocolors';

export async function promptTickers(): Promise<string[]> {
  const result = await p.text({
    message: 'Enter ticker symbols (comma-separated)',
    placeholder: 'TSLA,PLTR,GOOGL',
    validate: (value) => {
      if (!value?.trim()) return 'At least one ticker is required';
    },
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  return result
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}

export async function promptSortOrder(): Promise<{
  sort: 'asc' | 'desc';
  sortBy: 'ticker' | 'decision';
}> {
  const result = await p.select({
    message: 'Sort results',
    options: [
      { value: 'decision', label: 'By decision (BUY, SELL, HOLD, then score)' },
      { value: 'asc', label: 'By ticker, ascending (A → Z)' },
      { value: 'desc', label: 'By ticker, descending (Z → A)' },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  if (result === 'decision') return { sort: 'asc', sortBy: 'decision' };
  return { sort: result as 'asc' | 'desc', sortBy: 'ticker' };
}

export async function promptOutputFormat(): Promise<'csv' | 'json'> {
  const result = await p.select({
    message: 'Output format',
    options: [
      { value: 'csv', label: 'CSV' },
      { value: 'json', label: 'JSON' },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  return result as 'csv' | 'json';
}

export async function promptExtraOptions(): Promise<{
  fundamentals: boolean;
  news: boolean;
  options: boolean;
  dividends: boolean;
  earnings: boolean;
}> {
  const result = await p.multiselect({
    message: 'Additional data to include (press enter to skip)',
    options: [
      { value: 'fundamentals', label: 'Fundamentals (P/E, Market Cap)' },
      { value: 'news', label: 'Recent News' },
      { value: 'options', label: 'Options Chain' },
      { value: 'dividends', label: 'Dividend History' },
      { value: 'earnings', label: 'Earnings Data' },
    ],
    required: false,
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  const selected = result as string[];
  return {
    fundamentals: selected.includes('fundamentals'),
    news: selected.includes('news'),
    options: selected.includes('options'),
    dividends: selected.includes('dividends'),
    earnings: selected.includes('earnings'),
  };
}

export async function promptPortfolioAction(): Promise<{
  action: string;
  ticker?: string;
}> {
  const action = await p.select({
    message: 'Portfolio action',
    options: [
      { value: 'list', label: 'List assets' },
      { value: 'add', label: 'Add asset' },
      { value: 'remove', label: 'Remove asset' },
      { value: 'report', label: 'Performance report' },
    ],
  });

  if (p.isCancel(action)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  if (action === 'add' || action === 'remove') {
    const ticker = await p.text({
      message: `Ticker to ${action}`,
      placeholder: 'TSLA',
      validate: (value) => {
        if (!value?.trim()) return 'Ticker is required';
      },
    });

    if (p.isCancel(ticker)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }

    return { action: action as string, ticker: (ticker as string).trim().toUpperCase() };
  }

  return { action: action as string };
}

export { p, pc };
