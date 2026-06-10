'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { notify } from '@/features/alerts/utils/notify';

type PermissionState = NotificationPermission | 'unsupported';

export function NotificationPermissionCard() {
  const [permission, setPermission] = useState<PermissionState>('default');

  useEffect(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);

  async function requestPermission() {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') toast.success('Notifications enabled');
    else if (result === 'denied') toast.error('Notifications blocked by the browser');
  }

  async function sendTest() {
    await notify({
      title: 'TEST ALERT',
      body: 'Notifications are working. Rules will fire like this.',
      tag: 'test-alert',
      url: '/alerts',
    });
  }

  const statusColor =
    permission === 'granted'
      ? 'text-success'
      : permission === 'denied'
        ? 'text-destructive'
        : 'text-warning';

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="font-mono text-xs">
        <span className="text-muted-foreground">NOTIFICATION PERMISSION </span>
        <span className={statusColor}>{permission.toUpperCase()}</span>
        {permission === 'denied' && (
          <span className="block mt-1 text-muted-foreground">
            Blocked — alerts fall back to in-page toasts. Re-enable in browser site settings.
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {permission === 'default' && (
          <Button size="sm" className="font-mono text-xs" onClick={requestPermission}>
            ENABLE NOTIFICATIONS
          </Button>
        )}
        <Button size="sm" variant="secondary" className="font-mono text-xs" onClick={sendTest}>
          SEND TEST
        </Button>
      </div>
    </div>
  );
}
