'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User, Shield, Palette, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/input';

const nav = [
  { href: '/settings/profile', label: 'Profile', icon: User },
  { href: '/settings/account', label: 'Account & Security', icon: Shield },
  { href: '/settings/appearance', label: 'Appearance', icon: Palette },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <div className="flex min-h-screen w-full">
      <aside className="w-60 shrink-0 border-r bg-surface p-4">
        <Link href="/app" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          ← Back to app
        </Link>
        <nav className="space-y-1">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            User settings
          </p>
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                pathname === n.href && 'bg-muted text-foreground',
              )}
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-8 border-t pt-4">
          <Button variant="ghost" className="w-full justify-start" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </div>
      </aside>
      <div className="flex-1 overflow-y-auto p-10">
        <div className="mx-auto max-w-2xl">{children}</div>
      </div>
    </div>
  );
}
