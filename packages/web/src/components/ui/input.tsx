'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from './button';

// Convenience re-exports for form surfaces.
export { Button, buttonVariants };

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      'flex min-h-[72px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)}
    {...props}
  />
));
Label.displayName = 'Label';

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
    </div>
  );
}

export const Badge = ({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: 'default' | 'outline' | 'success' | 'warning' | 'danger' }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
      variant === 'default' && 'bg-accent-soft text-accent',
      variant === 'outline' && 'border text-muted-foreground',
      variant === 'success' && 'bg-success/15 text-success',
      variant === 'warning' && 'bg-warning/15 text-warning',
      variant === 'danger' && 'bg-danger/15 text-danger',
      className,
    )}
    {...props}
  />
);

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4 animate-spin text-muted-foreground', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Loading"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <h3 className="text-lg font-semibold">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}
