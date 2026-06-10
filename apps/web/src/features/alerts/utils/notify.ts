import { toast } from 'sonner';

interface NotifyOptions {
  title: string;
  body: string;
  /** Collapses duplicate notifications across tabs (use the rule id). */
  tag: string;
  /** Opened by the service worker's notificationclick handler. */
  url: string;
}

/**
 * Show an OS notification via the service worker registration (works inside
 * the installed PWA, unlike `new Notification()`); falls back to an in-page
 * toast when permission is missing.
 */
export async function notify({ title, body, tag, url }: NotifyOptions): Promise<void> {
  if (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted' &&
    'serviceWorker' in navigator
  ) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        tag,
        icon: '/icon.png',
        data: { url },
      });
      return;
    } catch {
      // fall through to toast
    }
  }
  toast(title, { description: body });
}
