'use client';

import { MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes can only resolve the active theme on the client. Until mounted,
  // server and first client render must produce identical markup to avoid a
  // hydration mismatch — so we render a stable placeholder icon/label.
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={
        mounted ? (isDark ? 'Switch to light theme' : 'Switch to dark theme') : 'Toggle theme'
      }
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {mounted && !isDark ? <MoonIcon aria-hidden="true" /> : <SunIcon aria-hidden="true" />}
    </Button>
  );
}
