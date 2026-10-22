'use client';

import * as React from 'react';
import { CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

const ToastContext = React.createContext<{
  toast: (t: Omit<ToastItem, 'id'>) => void;
}>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const counter = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = ++counter.current;
      setItems((prev) => [...prev.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === 'error' ? 6000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface-raised p-3 shadow-lg animate-slide-in-right',
            )}
            role="status"
          >
            {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : null}
            {t.kind === 'error' ? <XCircle className="mt-0.5 h-4 w-4 text-danger" /> : null}
            {t.kind === 'info' ? <Info className="mt-0.5 h-4 w-4 text-accent" /> : null}
            <div className="flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              ) : null}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastContext);
}
