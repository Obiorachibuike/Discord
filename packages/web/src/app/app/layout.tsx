'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Users, LogOut, Loader2, Wifi, WifiOff, Search, Bell } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import type { ConversationDTO } from '@aether/shared';
import { useRealtime, useServers, useConversations, useNotifications, useMarkAllNotificationsRead } from '@/lib/hooks';
import { ServerRail } from '@/components/layout/server-rail';
import { ChannelSidebar } from '@/components/layout/channel-sidebar';
import { SearchOverlay } from '@/components/chat/message-view';
import { Avatar, Tooltip } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/input';
import { cn, formatTime } from '@/lib/utils';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { connected } = useRealtime();
  const { data: serversData } = useServers();
  const { data: convsData } = useConversations();
  const { data: notifData } = useNotifications();
  const markAllRead = useMarkAllNotificationsRead();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [user, isLoading, router]);

  // Keyboard shortcut: Ctrl/Cmd+K opens search.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  const serverIdMatch = pathname.match(/\/app\/servers\/([^/]+)/);
  const activeServerId = serverIdMatch?.[1];
  const activeServer = serversData?.servers.find((s) => s.id === activeServerId);

  return (
    <div className="flex h-screen overflow-hidden">
      <ServerRail servers={serversData?.servers ?? []} activeServerId={activeServerId} />

      {activeServerId ? (
        <ChannelSidebar server={activeServer} />
      ) : (
        <DmSidebar conversations={convsData?.conversations ?? []} pathname={pathname} />
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 items-center gap-3 border-b px-4">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-8 flex-1 max-w-md items-center gap-2 rounded-md border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:border-accent/50"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search messages…</span>
            <kbd className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>
          <Tooltip label={connected ? 'Real-time connected' : 'Reconnecting…'} side="bottom">
            <span className={cn('flex items-center gap-1 text-xs', connected ? 'text-success' : 'text-warning')}>
              {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            </span>
          </Tooltip>
          <div className="relative">
            <Tooltip label="Notifications" side="bottom">
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="relative rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {(notifData?.unread ?? 0) > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
                    {notifData!.unread > 9 ? '9+' : notifData!.unread}
                  </span>
                ) : null}
              </button>
            </Tooltip>
            {notifOpen ? (
              <div className="absolute right-0 top-10 z-40 w-80 rounded-lg border bg-surface-raised p-2 shadow-xl animate-fade-in">
                <div className="flex items-center justify-between px-2 py-1">
                  <p className="text-sm font-semibold">Notifications</p>
                  <button
                    className="text-xs text-accent hover:underline"
                    onClick={() => {
                      markAllRead.mutate();
                      setNotifOpen(false);
                    }}
                  >
                    Mark all read
                  </button>
                </div>
                <div className="max-h-80 space-y-1 overflow-y-auto scroll-thin">
                  {(notifData?.notifications ?? []).slice(0, 12).map((n) => (
                    <div
                      key={n.id}
                      className={cn(
                        'rounded-md p-2 text-sm',
                        n.readAt ? 'opacity-60' : 'bg-accent-soft/40',
                      )}
                    >
                      <p className="font-medium">{n.title}</p>
                      <p className="text-xs text-muted-foreground">{n.body}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{formatTime(n.createdAt)}</p>
                    </div>
                  ))}
                  {(notifData?.notifications ?? []).length === 0 ? (
                    <p className="p-4 text-center text-xs text-muted-foreground">You&apos;re all caught up</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <Link href="/settings/profile" aria-label="Account settings">
            <Avatar name={user.displayName} src={user.avatarUrl} size="sm" status={user.presenceStatus} />
          </Link>
        </header>

        <div className="flex min-h-0 flex-1">{children}</div>
      </main>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} serverId={activeServerId} />
    </div>
  );
}

function DmSidebar({
  conversations,
  pathname,
}: {
  conversations: ConversationDTO[];
  pathname: string;
}) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-surface">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <h2 className="text-sm font-semibold">Direct messages</h2>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 scroll-thin">
        <Link
          href="/app/friends"
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            pathname === '/app/friends' && 'bg-muted text-foreground',
          )}
        >
          <Users className="h-4 w-4" /> Friends
        </Link>
        <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Conversations
        </div>
        {conversations.map((c) => {
          const other = c.members[0];
          const name = c.name ?? other?.displayName ?? 'Conversation';
          const active = pathname.includes(c.id);
          return (
            <Link
              key={c.id}
              href={`/app/dms/${c.id}`}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                active && 'bg-muted text-foreground',
              )}
            >
              <Avatar
                name={name}
                src={other?.avatarUrl}
                size="xs"
                status={other?.presenceStatus}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate">{name}</p>
                {c.lastMessage ? (
                  <p className="truncate text-[10px] text-muted-foreground">{c.lastMessage.content}</p>
                ) : null}
              </div>
              {c.unread > 0 ? <Badge variant="danger">{c.unread}</Badge> : null}
            </Link>
          );
        })}
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            No conversations yet. Find a friend and say hi!
          </p>
        ) : null}
      </nav>
      <UserBarFooter />
    </aside>
  );
}

function UserBarFooter() {
  const { user, logout } = useAuth();
  return (
    <div className="flex items-center gap-2 border-t bg-surface-raised/50 px-2 py-2">
      <Link href="/settings/profile" className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 hover:bg-muted/50">
        <Avatar name={user?.displayName ?? 'Me'} src={user?.avatarUrl} size="sm" status={user?.presenceStatus} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{user?.displayName}</p>
          <p className="truncate text-[10px] text-muted-foreground">@{user?.username}</p>
        </div>
      </Link>
      <Tooltip label="Log out" side="top">
        <button
          onClick={() => void logout()}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Log out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </Tooltip>
    </div>
  );
}
