'use client';

import * as React from 'react';

export type ThemeMode = 'dark' | 'light';

const THEME_KEY = 'aether.theme';
const ACCENT_KEY = 'aether.accent';

export const ACCENT_PRESETS = [
  { name: 'Indigo', value: '245 75% 58%' },
  { name: 'Violet', value: '270 70% 56%' },
  { name: 'Emerald', value: '160 65% 42%' },
  { name: 'Rose', value: '340 75% 56%' },
  { name: 'Amber', value: '32 90% 50%' },
  { name: 'Sky', value: '205 85% 50%' },
] as const;

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  accent: string;
  setAccent: (hsl: string) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ThemeMode>('dark');
  const [accent, setAccentState] = React.useState<string>(ACCENT_PRESETS[0]!.value);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    const system = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    const next = savedTheme ?? system;
    setModeState(next);
    const savedAccent = localStorage.getItem(ACCENT_KEY);
    if (savedAccent) setAccentState(savedAccent);
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--ring', accent);
    document.documentElement.style.setProperty('--accent-soft', `hsl(${accent} / 0.16)`);
    localStorage.setItem(THEME_KEY, mode);
    localStorage.setItem(ACCENT_KEY, accent);
  }, [mode, accent, mounted]);

  const value = React.useMemo(
    () => ({
      mode,
      setMode: setModeState,
      accent,
      setAccent: setAccentState,
    }),
    [mode, accent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
