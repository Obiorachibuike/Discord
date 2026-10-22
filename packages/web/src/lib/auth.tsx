'use client';

import * as React from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { SelfUserDTO } from '@aether/shared';
import { apiGet, apiPost, ApiError } from './api';
import { disconnectSocket } from './socket';

interface AuthContextValue {
  user: SelfUserDTO | null;
  isLoading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const query: UseQueryResult<{ user: SelfUserDTO }> = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiGet<{ user: SelfUserDTO }>('/api/auth/me'),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000,
  });

  const logout = React.useCallback(async () => {
    try {
      await apiPost('/api/auth/logout');
    } finally {
      disconnectSocket();
      queryClient.clear();
      window.location.href = '/login';
    }
  }, [queryClient]);

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user: query.data?.user ?? null,
        isLoading: query.isLoading,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return React.useContext(AuthContext);
}
