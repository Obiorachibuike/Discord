'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-surface-raised p-6 shadow-xl animate-fade-in',
          className,
        )}
        {...props}
      >
        <div className="mb-4">
          <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
        </div>
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-md px-4 py-2 text-sm hover:bg-muted"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
              destructive ? 'bg-danger hover:bg-danger/90' : 'bg-accent hover:bg-accent/90',
            )}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DialogHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('space-y-1.5', className)}>{children}</div>;
}

export function DialogTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h2 className={cn('text-lg font-semibold', className)}>{children}</h2>;
}

export function DialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}>{children}</div>
  );
}
