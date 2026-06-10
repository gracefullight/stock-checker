import type { NewsItemDTO } from '@/lib/api';

interface NewsPanelProps {
  news: NewsItemDTO[];
}

/** "3h ago" / "2d ago" from an RFC-822 RSS pubDate; falls back to the raw string. */
function relativeTime(pubDate: string): string {
  const t = Date.parse(pubDate);
  if (Number.isNaN(t)) return pubDate;
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NewsPanel({ news }: NewsPanelProps) {
  if (news.length === 0) {
    return <div className="font-mono text-xs text-muted-foreground">NO NEWS AVAILABLE</div>;
  }
  return (
    <ul className="divide-y divide-border/50" aria-label="Latest news headlines">
      {news.map((item) => (
        <li key={item.url} className="py-2 first:pt-0 last:pb-0">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-foreground hover:text-primary transition-colors"
          >
            {item.title}
          </a>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {relativeTime(item.publishedAt)}
          </div>
        </li>
      ))}
    </ul>
  );
}
