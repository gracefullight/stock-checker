import { SerwistProvider } from '@serwist/turbopack/react';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import '@/app/globals.css';
import { ThemeProvider } from '@/components/common/theme-provider';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { FearGreedDisplay } from '@/components/fear-greed-display';
import { FxDisplay } from '@/components/fx-display';
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
              <header className="sticky top-0 z-50 flex min-w-0 flex-col gap-2 px-4 py-1.5 bg-card border-b border-border lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-4">
                  <span className="text-xs font-bold font-mono tracking-widest text-primary">
                    STOCK SCREENER
                  </span>
                  <nav
                    className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
                    aria-label="Main navigation"
                  >
                    <Link
                      href="/"
                      prefetch={false}
                      className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      [SCREENER]
                    </Link>
                    <Link
                      href="/market-screen"
                      prefetch={false}
                      className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      [MARKET SCREEN]
                    </Link>
                    <Link
                      href="/portfolio"
                      prefetch={false}
                      className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      [PORTFOLIO]
                    </Link>
                    <Link
                      href="/watchlist"
                      prefetch={false}
                      className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      [WATCHLIST]
                    </Link>
                    <Link
                      href="/alerts"
                      prefetch={false}
                      className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      [ALERTS]
                    </Link>
                  </nav>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <FxDisplay />
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
