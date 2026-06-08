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

    const titleMatch = /<title>(.*?)<\/title>/g;
    const linkMatch = /<link>(.*?)<\/link>/g;
    const dateMatch = /<pubDate>(.*?)<\/pubDate>/g;
    const descMatch = /<description>(.*?)<\/description>/g;

    const titles = xml.match(titleMatch) || [];
    const links = xml.match(linkMatch) || [];
    const dates = xml.match(dateMatch) || [];
    const descs = xml.match(descMatch) || [];

    for (let i = 0; i < Math.min(titles.length, limit); i++) {
      items.push({
        title: titles[i]?.replace(/<[^>]+>/g, '').trim() || '',
        url: links[i]?.replace(/<[^>]+>/g, '').trim() || '',
        publishedAt: dates[i]?.replace(/<[^>]+>/g, '').trim() || '',
        summary: (descs[i]?.replace(/<[^>]+>/g, '').substring(0, 200) || '').trim(),
      });
    }

    return items;
  } catch (error) {
    logger.error({ error, ticker }, 'Failed to fetch news');
    return [];
  }
}
