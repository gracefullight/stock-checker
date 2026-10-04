import type { Metadata } from 'next';
import { MarketScreenDashboard } from '@/features/market-screen/components/market-screen-dashboard';

export const metadata: Metadata = {
  title: 'Market Screen — Stock Checker',
  description: 'Saved Finviz candidate jobs and Stock Checker final decisions',
};

export default function MarketScreenPage() {
  return <MarketScreenDashboard />;
}
