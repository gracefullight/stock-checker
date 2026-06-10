import { SerwistProvider } from '@serwist/turbopack/react';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import '@/app/globals.css';
import { ThemeProvider } from '@/components/common/theme-provider';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { FearGreedDisplay } from '@/components/fear-greed-display';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AlertEngine } from '@/features/alerts/components/alert-engine';

export const viewport: Viewport = {
  themeColor: '#00bcd4',
};

export const metadata: Metadata = {
  title: 'Stock Screener',
  description: 'Momentum-based equity screener with institutional analysis',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground">
        <SerwistProvider swUrl="/serwist/sw.js">
          <ThemeProvider>
            <TooltipProvider>
              {/* Top status bar */}
              <header className="sticky top-0 z-50 flex items-center justify-between px-4 py-1.5 bg-card border-b border-border">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold font-mono tracking-widest text-primary">
                    STOCK SCREENER
                  </span>
                  <nav className="flex items-center gap-3" aria-label="Main navigation">
                    <Link
                      href="/"
                      className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      [SCREENER]
                    </Link>
                    <Link
                      href="/portfolio"
                      className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      [PORTFOLIO]
                    </Link>
                    <Link
                      href="/watchlist"
                      className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      [WATCHLIST]
                    </Link>
                    <Link
                      href="/alerts"
                      className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      [ALERTS]
                    </Link>
                  </nav>
                </div>
                <div className="flex items-center gap-2">
                  <FearGreedDisplay />
                  <ThemeToggle />
                </div>
              </header>

              <main className="p-4">{children}</main>

              <AlertEngine />
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
