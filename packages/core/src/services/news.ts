import axios from 'axios';
import pino from 'pino';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

const axiosInstance = axios.create({
  timeout: 30000,
  maxRedirects: 5,
});

export interface NewsItem {
  title: string;
  url: string;
  publishedAt: string;
  summary: string;
}

export async function getStockNews(ticker: string, limit = 5): Promise<NewsItem[]> {
  try {
    const res = await axiosInstance.get(
      `https://news.google.com/rss/search?q=${ticker}+stock&hl=en&gl=US&ceid=US`,
      {
        timeout: 10000,
      }
    );

    const items: NewsItem[] = [];
    const xml = res.data as string;

    // Parse per <item> block: the feed-level <title>/<link> (channel header)
    // must not leak in as the first headline.
    const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

    const extract = (block: string, tag: string): string => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return (m?.[1] ?? '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .trim();
    };

    for (const block of itemBlocks.slice(0, limit)) {
      items.push({
        title: extract(block, 'title'),
        url: extract(block, 'link'),
        publishedAt: extract(block, 'pubDate'),
        summary: extract(block, 'description').substring(0, 200).trim(),
      });
    }

    return items;
  } catch (error) {
    logger.error({ error, ticker }, 'Failed to fetch news');
    return [];
  }
}
