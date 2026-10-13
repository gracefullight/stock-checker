const MAX_LENGTH = 200;

/**
 * Error text that is safe to return to a client: provider URLs (which can carry
 * keys) and absolute paths are redacted, and the message is bounded.
 */
export function safeErrorText(error: unknown, fallback = 'Request failed.'): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const redacted = message
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+/gi, '[url]')
    .replace(/(?:^|\s)(?:\/[\w.@-]+){2,}/g, ' [path]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!redacted) return fallback;
  return redacted.length > MAX_LENGTH ? `${redacted.slice(0, MAX_LENGTH - 1)}…` : redacted;
}
