'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/lib/theme';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (count, err) =>
              !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
            staleTime: 15_000,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
