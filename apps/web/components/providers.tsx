'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 } } }));
  useEffect(() => {
    const preference = localStorage.getItem('cove-theme') || 'dark';
    const accent = localStorage.getItem('cove-accent') || 'violet';
    document.documentElement.dataset.theme = preference === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : preference;
    document.documentElement.dataset.accent = accent;
  }, []);
  return <QueryClientProvider client={client}>{children}<Toaster position="top-right" theme="system" richColors closeButton /></QueryClientProvider>;
}
export function applyAppearance(theme: string, accent: string) {
  localStorage.setItem('cove-theme', theme); localStorage.setItem('cove-accent', accent);
  document.documentElement.dataset.theme = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  document.documentElement.dataset.accent = accent;
}
