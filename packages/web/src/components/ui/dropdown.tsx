'use client';

import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  align = 'end',
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-[10rem] overflow-hidden rounded-md border bg-surface-overlay p-1 shadow-lg animate-fade-in',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        destructive && 'text-danger focus:bg-danger/10',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator(
  props: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>,
) {
  return (
    <DropdownMenuPrimitive.Separator className="my-1 h-px bg-border" {...props} />
  );
}

export function DropdownMenuLabel(
  props: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>,
) {
  return (
    <DropdownMenuPrimitive.Label
      className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
      {...props}
    />
  );
}
