'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Check, X, Clock, Ban, MessageSquareText } from 'lucide-react';
import type { FriendDTO, PublicUserDTO } from '@aether/shared';
import { Button, Input, Spinner, Badge, EmptyState } from '@/components/ui/input';
import { Avatar, Tooltip } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import {
  useFriends,
  useBlocks,
  useSendFriendRequest,
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useBlockUser,
  useUnblockUser,
  useStartDm,
} from '@/lib/hooks';

type Tab = 'online' | 'all' | 'pending' | 'blocked';

export default function FriendsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = React.useState<Tab>('online');
  const [query, setQuery] = React.useState('');
  const [newFriend, setNewFriend] = React.useState('');

  const { data: friendsData, isLoading } = useFriends();
  const { data: blocksData } = useBlocks();
  const sendRequest = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const decline = useDeclineFriendRequest();
  const block = useBlockUser();
  const unblock = useUnblockUser();
  const startDm = useStartDm();

  const friends = friendsData?.friends ?? [];
  const filtered = friends.filter((f: FriendDTO) => {
    const q = query.toLowerCase();
    const match =
      q === '' ||
      f.user.displayName.toLowerCase().includes(q) ||
      f.user.username.toLowerCase().includes(q);
    if (tab === 'online') return match && f.user.presenceStatus && f.user.presenceStatus !== 'OFFLINE';
    return match;
  });

  const openDm = async (userId: string) => {
    try {
      const { conversation } = await startDm.mutateAsync({ userId });
      router.push(`/app/dms/${conversation.id}`);
    } catch {
      toast({ kind: 'error', title: 'Could not start a conversation' });
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Tabs tab={tab} setTab={setTab} pending={(friendsData?.incoming ?? []).length} />
        <div className="ml-auto">
          <form
            className="flex items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newFriend.trim()) return;
              try {
                await sendRequest.mutateAsync({ username: newFriend.trim() });
                toast({ kind: 'success', title: 'Friend request sent' });
                setNewFriend('');
              } catch (err) {
                toast({
                  kind: 'error',
                  title: 'Could not send request',
                  description: err instanceof Error ? err.message : undefined,
                });
              }
            }}
          >
            <Input
              placeholder="username"
              value={newFriend}
              onChange={(e) => setNewFriend(e.target.value)}
              className="h-8 w-40 text-sm"
            />
            <Button size="sm" type="submit" disabled={sendRequest.isPending}>
              <UserPlus className="h-4 w-4" /> Add Friend
            </Button>
          </form>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scroll-thin">
        {tab === 'pending' ? (
          <PendingList
            incoming={friendsData?.incoming ?? []}
            outgoing={friendsData?.outgoing ?? []}
            onAccept={(requestId) => accept.mutate({ requestId })}
            onDecline={(requestId) => decline.mutate({ requestId })}
          />
        ) : tab === 'blocked' ? (
          <BlockedList
            blocked={blocksData?.blocked ?? []}
            onUnblock={(userId) => unblock.mutate({ userId })}
          />
        ) : (
          <>
            <Input
              placeholder="Search friends…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mb-4 max-w-md"
            />
            {isLoading ? (
              <Spinner />
            ) : filtered.length === 0 ? (
              <EmptyState
                title={tab === 'online' ? 'No one is online right now' : 'No friends yet'}
                description="Add friends with their username to start chatting, or join a server to meet people."
              />
            ) : (
              <ul className="space-y-1">
                {filtered.map((f: FriendDTO) => (
                  <li
                    key={f.id}
                    className="group flex items-center gap-3 rounded-md border-b border-border/40 px-3 py-2.5 hover:bg-muted/40"
                  >
                    <Avatar
                      name={f.user.displayName}
                      src={f.user.avatarUrl}
                      status={f.user.presenceStatus}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{f.user.displayName}</p>
                      <p className="text-xs text-muted-foreground">@{f.user.username}</p>
                    </div>
                    {f.user.customStatus ? (
                      <span className="max-w-40 truncate text-xs text-muted-foreground">
                        {f.user.customStatus}
                      </span>
                    ) : null}
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Tooltip label="Message">
                        <Button variant="ghost" size="icon" onClick={() => void openDm(f.user.id)}>
                          <MessageSquareText className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                      <Tooltip label="Block">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            block.mutate(
                              { userId: f.user.id },
                              { onError: () => toast({ kind: 'error', title: 'Block failed' }) },
                            )
                          }
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Tabs({ tab, setTab, pending }: { tab: Tab; setTab: (t: Tab) => void; pending: number }) {
  const items: { id: Tab; label: string; badge?: number }[] = [
    { id: 'online', label: 'Online' },
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending', badge: pending },
    { id: 'blocked', label: 'Blocked' },
  ];
  return (
    <div className="flex items-center gap-1">
      {items.map((i) => (
        <button
          key={i.id}
          onClick={() => setTab(i.id)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === i.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {i.label}
          {i.badge ? <Badge variant="danger">{i.badge}</Badge> : null}
        </button>
      ))}
    </div>
  );
}

function PendingList({
  incoming,
  outgoing,
  onAccept,
  onDecline,
}: {
  incoming: FriendDTO[];
  outgoing: FriendDTO[];
  onAccept: (requestId: string) => void;
  onDecline: (requestId: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Incoming</h3>
        {incoming.length === 0 ? (
          <EmptyState
            title="No pending requests"
            description="When someone adds you, it shows up here."
          />
        ) : (
          <ul className="space-y-2">
            {incoming.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Avatar name={r.user.displayName} src={r.user.avatarUrl} size="sm" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{r.user.displayName}</p>
                  <p className="text-xs text-muted-foreground">@{r.user.username}</p>
                </div>
                <Tooltip label="Accept">
                  <Button size="icon" variant="ghost" onClick={() => onAccept(r.id)}>
                    <Check className="h-4 w-4 text-success" />
                  </Button>
                </Tooltip>
                <Tooltip label="Decline">
                  <Button size="icon" variant="ghost" onClick={() => onDecline(r.id)}>
                    <X className="h-4 w-4 text-danger" />
                  </Button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Outgoing</h3>
        <ul className="space-y-2">
          {outgoing.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <Avatar name={r.user.displayName} src={r.user.avatarUrl} size="sm" />
              <div className="flex-1">
                <p className="text-sm font-medium">{r.user.displayName}</p>
                <p className="text-xs text-muted-foreground">@{r.user.username}</p>
              </div>
              <Badge variant="warning">
                <Clock className="h-3 w-3" /> Pending
              </Badge>
            </li>
          ))}
          {outgoing.length === 0 ? (
            <p className="text-sm text-muted-foreground">No outgoing requests.</p>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

function BlockedList({
  blocked,
  onUnblock,
}: {
  blocked: PublicUserDTO[];
  onUnblock: (userId: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Blocked users</h3>
      {blocked.length === 0 ? (
        <EmptyState
          title="No blocked users"
          description="Blocking someone hides them from you completely."
        />
      ) : (
        <ul className="space-y-2">
          {blocked.map((b) => (
            <li key={b.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <Avatar name={b.displayName} src={b.avatarUrl} size="sm" />
              <div className="flex-1">
                <p className="text-sm font-medium">{b.displayName}</p>
                <p className="text-xs text-muted-foreground">@{b.username}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => onUnblock(b.id)}>
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
