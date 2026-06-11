'use client';

import { useSyncExternalStore } from 'react';

/** Mirrors SUPPORTED_FX_CURRENCIES on the API side. */
export const FX_CURRENCIES = [
  'KRW',
  'JPY',
  'EUR',
  'GBP',
  'CNY',
  'HKD',
  'TWD',
  'AUD',
  'CAD',
  'INR',
] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

export const DEFAULT_CURRENCY: FxCurrency = 'KRW';
const STORAGE_KEY = 'display-currency';

/**
 * Tiny shared currency store (no context, no prop drilling): components
 * subscribe via useDisplayCurrency(); the selection persists in localStorage.
 */
let current: FxCurrency = DEFAULT_CURRENCY;
let hydrated = false;
const listeners = new Set<() => void>();

function isFxCurrency(v: string | null): v is FxCurrency {
  return v !== null && (FX_CURRENCIES as readonly string[]).includes(v);
}

function hydrate(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (isFxCurrency(saved)) current = saved;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): FxCurrency {
  hydrate();
  return current;
}

function getServerSnapshot(): FxCurrency {
  return DEFAULT_CURRENCY;
}

export function setDisplayCurrency(currency: FxCurrency): void {
  current = currency;
  try {
    window.localStorage.setItem(STORAGE_KEY, currency);
  } catch {
    /* private mode etc. — selection just won't persist */
  }
  for (const l of listeners) l();
}

export function useDisplayCurrency(): FxCurrency {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Format a USD amount in the target currency, e.g. fx(245.3, 1385.5, 'KRW') → "₩339,884". */
export function formatInCurrency(usdAmount: number, rate: number, currency: FxCurrency): string {
  const value = usdAmount * rate;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

/** Format the rate itself, e.g. "1,385.5". */
export function formatRate(rate: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: rate >= 100 ? 1 : 4,
  }).format(rate);
}
