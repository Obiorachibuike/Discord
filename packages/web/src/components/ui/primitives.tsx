'use client';

import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn, initials } from '@/lib/utils';

// ─── Avatar ──────────────────────────────────────────────────────────────────

export function Avatar({
  src,
  name,
  size = 'md',
  className,
  status,
}: {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  status?: 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE' | 'OFFLINE';
}) {
  const sizeCls =
    size === 'xs' ? 'h-6 w-6 text-[9px]' : size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-16 w-16 text-xl' : 'h-10 w-10 text-sm';
  const statusColors: Record<string, string> = {
    ONLINE: 'bg-success',
    IDLE: 'bg-warning',
    DND: 'bg-danger',
    INVISIBLE: 'bg-muted-foreground',
    OFFLINE: 'bg-muted-foreground/50',
  };
  return (
    <div className={cn('relative inline-flex shrink-0', className)}>
      <AvatarPrimitive.Root className={cn('relative inline-flex overflow-hidden rounded-full', sizeCls)}>
        <AvatarPrimitive.Image src={src ?? undefined} alt={name} className="h-full w-full object-cover" />
        <AvatarPrimitive.Fallback
          className="flex h-full w-full items-center justify-center bg-accent-soft font-semibold text-accent"
          delayMs={0}
        >
          {initials(name)}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {status ? (
        <span
          className={cn(
            'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface',
            statusColors[status],
          )}
          title={status}
        />
      ) : null}
    </div>
  );
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({
  label,
  side = 'right',
  children,
}: {
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background shadow-md animate-fade-in"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ─── Switch ──────────────────────────────────────────────────────────────────

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent data-[state=unchecked]:bg-muted',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';
