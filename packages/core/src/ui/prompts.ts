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

export async function promptSortOrder(): Promise<'asc' | 'desc'> {
  const result = await p.select({
    message: 'Sort order',
    options: [
      { value: 'asc', label: 'Ascending (A → Z)' },
      { value: 'desc', label: 'Descending (Z → A)' },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  return result as 'asc' | 'desc';
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

export async function promptOptimize(): Promise<{
  symbol: string;
  trials: number;
}> {
  const symbol = await p.text({
    message: 'Symbol to optimize',
    placeholder: 'TSLA',
    defaultValue: 'TSLA',
  });

  if (p.isCancel(symbol)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  const trials = await p.text({
    message: 'Number of trials',
    placeholder: '200',
    defaultValue: '200',
    validate: (value) => {
      const n = parseInt(value ?? '', 10);
      if (Number.isNaN(n) || n < 1) return 'Must be a positive number';
    },
  });

  if (p.isCancel(trials)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  return {
    symbol: (symbol as string).trim().toUpperCase(),
    trials: parseInt(trials as string, 10),
  };
}

export { p, pc };
