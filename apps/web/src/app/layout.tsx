import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { FearGreedDisplay } from '@/components/fear-greed-display';

export const metadata: Metadata = {
  title: 'Stock Screener',
  description: 'Bloomberg-style stock screener dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
        {/* Top status bar */}
        <header className="sticky top-0 z-50 flex items-center justify-between px-4 py-1.5 bg-[var(--surface)] border-b border-[var(--border)]">
          <div className="flex items-center gap-4">
            <span className="text-xs font-bold font-mono tracking-widest text-[var(--cyan)]">
              STOCK SCREENER
            </span>
            <nav className="flex items-center gap-3" aria-label="Main navigation">
              <Link
                href="/"
                className="text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                [SCREENER]
              </Link>
              <Link
                href="/portfolio"
                className="text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                [PORTFOLIO]
              </Link>
            </nav>
          </div>
          <FearGreedDisplay />
        </header>

        <main className="p-4">{children}</main>
      </body>
    </html>
  );
}
