import { Card, CardContent } from '@/components/ui/card';

export const metadata = {
  title: 'Offline — Stock Screener',
};

export default function OfflinePage() {
  return (
    <div className="flex justify-center pt-16">
      <Card className="max-w-sm w-full">
        <CardContent className="py-8 text-center space-y-2">
          <p className="font-mono text-sm font-bold tracking-widest text-warning">OFFLINE</p>
          <p className="font-mono text-xs text-muted-foreground">
            No network connection. Previously visited pages are still available; reconnect to
            refresh data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
