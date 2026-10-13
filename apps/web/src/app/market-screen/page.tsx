import type { Metadata } from 'next';
import { MarketScreenDashboard } from '@/features/market-screen/components/market-screen-dashboard';
import { parseMarketScreenJobId } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Market Screen — Stock Checker',
  description: 'Saved candidate jobs and Stock Checker final decisions',
};

interface PageProps {
  searchParams: Promise<{ job?: string | string[] }>;
}

/** `/market-screen?job=<uuid>` opens that saved job directly (daily-report deep link). */
export default async function MarketScreenPage({ searchParams }: PageProps) {
  const { job } = await searchParams;
  return <MarketScreenDashboard initialJobId={parseMarketScreenJobId(job)} />;
}
