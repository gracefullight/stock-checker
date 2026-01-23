import axios from 'axios';
import pino from 'pino';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' }
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
    const res = await axiosInstance.get(`https://news.google.com/rss/search?q=${ticker}+stock&hl=en&gl=US&ceid=US`, {
      timeout: 10000,
    });
    const parser = new DOMParser();
    const xml = await res.data;

    const items: NewsItem[] = [];
    const newsItems = xml.querySelectorAll('item');

    for (const item of Array.from(newsItems).slice(0, limit)) {
      const title = item.querySelector('title')?.textContent || '';
      const link = item.querySelector('link')?.textContent || '';
      const pubDate = item.querySelector('pubDate')?.textContent || '';
      const description = item.querySelector('description')?.textContent || '';

      items.push({
        title: title.trim(),
        url: link.trim(),
        publishedAt: pubDate.trim(),
        summary: description.substring(0, 200).trim(),
      });
    }

    return items;
  } catch (error) {
    logger.error({ error, ticker }, 'Failed to fetch news');
    return [];
  }
}
