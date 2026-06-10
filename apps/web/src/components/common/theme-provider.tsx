'use client';

import { useServerInsertedHTML } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

/** Same key next-themes used, so previously stored preferences carry over. */
const STORAGE_KEY = 'theme';
const DEFAULT_THEME: Theme = 'dark';

/**
 * Pre-hydration theme bootstrap. Injected via useServerInsertedHTML so the
 * script lives outside the React tree: it executes as the streamed HTML is
 * parsed (no FOUC) and React 19 never renders a <script> element on the
 * client (which it warns about and would not execute anyway).
 */
const INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark'&&t!=='system')t='${DEFAULT_THEME}';var r=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(r);e.style.colorScheme=r;}catch(_){}})()`;

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : DEFAULT_THEME;
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server and first client render stay on the default so markup matches
  // during hydration; the stored preference is picked up after mount (the
  // bootstrap script has already painted the right theme on <html>).
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('dark');

  const insertedScript = useRef(false);
  useServerInsertedHTML(() => {
    if (insertedScript.current) return null;
    insertedScript.current = true;
    // biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap, no user input
    return <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />;
  });

  const syncFromStorage = useCallback(() => {
    const stored = readStoredTheme();
    const resolved = resolveTheme(stored);
    setThemeState(stored);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  useEffect(() => {
    syncFromStorage();
  }, [syncFromStorage]);

  // Follow OS preference changes while in system mode.
  useEffect(() => {
    if (theme !== 'system') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const resolved: ResolvedTheme = query.matches ? 'dark' : 'light';
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  // Cross-tab sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) syncFromStorage();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [syncFromStorage]);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    const resolved = resolveTheme(next);
    setThemeState(next);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
