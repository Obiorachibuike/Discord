'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Hash,
  Volume2,
  Megaphone,
  ChevronDown,
  Plus,
  Settings,
  UserPlus,
  LogOut,
  Trash2,
  Mic,
  Headphones,
  Shield,
} from 'lucide-react';
import type { ChannelDTO, ServerDTO } from '@aether/shared';
import { Permissions, hasPermission } from '@aether/shared';
import { cn } from '@/lib/utils';
import { Avatar, Tooltip, Switch } from '@/components/ui/primitives';
import { Dialog, DialogContent, ConfirmDialog } from '@/components/ui/dialog';
import { Button, Field, Input, Textarea } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { useAuth } from '@/lib/auth';
import { useChannels, type ChannelListResponse } from '@/lib/hooks';
import { useToast } from '@/components/ui/toast';
import { apiPost, apiDelete, apiPatch } from '@/lib/api';

const channelIcon = (type: ChannelDTO['type']) =>
  type === 'VOICE' ? Volume2 : type === 'ANNOUNCEMENT' ? Megaphone : Hash;

export function ChannelSidebar({
  server,
  onOpenVoice,
  activeVoiceChannelId,
}: {
  server?: ServerDTO;
  onOpenVoice?: (channelId: string) => void;
  activeVoiceChannelId?: string | null;
}) {
  const params = useParams<{ serverId?: string; channelId?: string; conversationId?: string }>();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const serverId = params.serverId;
  const { data: channelsData, isLoading } = useChannels(serverId);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [leaveOpen, setLeaveOpen] = React.useState(false);

  const canManage = channelsData?.canManage ?? false;
  const myPerms = BigInt(server?.myPermissions ?? '0');

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-surface">
      {/* Server header */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex h-12 items-center justify-between px-4 text-sm font-semibold transition-colors hover:bg-muted/50">
            <span className="truncate">{server?.name ?? 'Aether'}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {server ? (
            <>
              <DropdownMenuItem onSelect={() => setInviteOpen(true)}>
                <UserPlus className="h-4 w-4" /> Invite people
              </DropdownMenuItem>
              {hasPermission(myPerms, Permissions.MANAGE_SERVER) ? (
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                  <Settings className="h-4 w-4" /> Server settings
                </DropdownMenuItem>
              ) : null}
              {hasPermission(myPerms, Permissions.MANAGE_ROLES) ? (
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                  <Shield className="h-4 w-4" /> Roles & permissions
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setLeaveOpen(true)}>
                <LogOut className="h-4 w-4" /> Leave server
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 scroll-thin">
        {isLoading ? (
          <div className="space-y-2 p-2">
            <div className="skeleton h-6 w-full" />
            <div className="skeleton h-6 w-3/4" />
            <div className="skeleton h-6 w-5/6" />
          </div>
        ) : channelsData ? (
          <ChannelGroups
            data={channelsData}
            activeChannelId={params.channelId}
            activeVoiceChannelId={activeVoiceChannelId}
            onOpenVoice={onOpenVoice}
            canManage={canManage}
            serverId={serverId!}
          />
        ) : (
          <p className="p-3 text-xs text-muted-foreground">Select a server to see its channels.</p>
        )}
      </div>

      {/* Voice status bar */}
      {activeVoiceChannelId ? <VoiceStatusBar channelId={activeVoiceChannelId} /> : null}

      {/* User bar */}
      <div className="flex items-center gap-2 border-t bg-surface-raised/50 px-2 py-2">
        <Link href="/settings/profile" className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 hover:bg-muted/50">
          <Avatar name={user?.displayName ?? 'Me'} src={user?.avatarUrl} size="sm" status={user?.presenceStatus} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{user?.displayName}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {user?.customStatus || '@' + (user?.username ?? '')}
            </p>
          </div>
        </Link>
        <Tooltip label="Mute (coming from voice)" side="top">
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground" aria-label="Mute">
            <Mic className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip label="Deafen" side="top">
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground" aria-label="Deafen">
            <Headphones className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip label="Log out" side="top">
          <button
            onClick={() => void logout()}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      {serverId ? (
        <>
          <CreateChannelDialog open={createOpen} onOpenChange={setCreateOpen} serverId={serverId} />
          <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} serverId={serverId} />
          <ServerSettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            server={server}
            serverId={serverId}
          />
          <ConfirmDialog
            open={leaveOpen}
            onOpenChange={setLeaveOpen}
            title="Leave server?"
            description={`You will lose access to ${server?.name ?? 'this server'}. You can rejoin with an invite.`}
            confirmLabel="Leave"
            destructive
            onConfirm={async () => {
              try {
                await apiPost(`/api/servers/${serverId}/leave`);
                toast({ kind: 'success', title: 'Left server' });
                router.push('/app/friends');
              } catch (err) {
                toast({ kind: 'error', title: 'Could not leave', description: (err as Error).message });
              } finally {
                setLeaveOpen(false);
              }
            }}
          />
        </>
      ) : null}
    </aside>
  );
}

function ChannelGroups({
  data,
  activeChannelId,
  activeVoiceChannelId,
  onOpenVoice,
  canManage,
  serverId,
}: {
  data: ChannelListResponse;
  activeChannelId?: string;
  activeVoiceChannelId?: string | null;
  onOpenVoice?: (id: string) => void;
  canManage: boolean;
  serverId: string;
}) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderChannel = (ch: ChannelDTO) => {
    const Icon = channelIcon(ch.type);
    const active = activeChannelId === ch.id;
    const inVoice = ch.type === 'VOICE' && activeVoiceChannelId === ch.id;
    return (
      <Link
        key={ch.id}
        href={
          ch.type === 'VOICE'
            ? `/app/servers/${serverId}/channels/${ch.id}`
            : `/app/servers/${serverId}/channels/${ch.id}`
        }
        onClick={() => {
          if (ch.type === 'VOICE') onOpenVoice?.(ch.id);
        }}
        className={cn(
          'group mx-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground',
          (active || inVoice) && 'bg-muted text-foreground',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{ch.name}</span>
        {ch.isPrivate ? <span className="ml-auto text-[10px] opacity-60">🔒</span> : null}
      </Link>
    );
  };

  return (
    <div className="space-y-4">
      {data.categories.map((cat) => (
        <div key={cat.id}>
          <button
            onClick={() => toggle(cat.id)}
            className="flex w-full items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', collapsed.has(cat.id) && '-rotate-90')} />
            <span className="truncate">{cat.name}</span>
            {canManage ? (
              <Plus
                className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault();
                }}
              />
            ) : null}
          </button>
          {!collapsed.has(cat.id) ? (
            <div className="mt-0.5 space-y-0.5">{cat.channels.map(renderChannel)}</div>
          ) : null}
        </div>
      ))}
      {data.uncategorized.length ? (
        <div className="space-y-0.5">{data.uncategorized.map(renderChannel)}</div>
      ) : null}
    </div>
  );
}

function VoiceStatusBar({ channelId }: { channelId: string }) {
  return (
    <div className="flex items-center justify-between border-t bg-accent-soft/40 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 text-success">
        <Volume2 className="h-4 w-4" />
        <span>Voice connected</span>
      </div>
      <span className="text-muted-foreground">#{channelId.slice(0, 6)}</span>
    </div>
  );
}

function CreateChannelDialog({
  open,
  onOpenChange,
  serverId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  serverId: string;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<'TEXT' | 'VOICE' | 'ANNOUNCEMENT'>('TEXT');
  const [topic, setTopic] = React.useState('');
  const [isPrivate, setIsPrivate] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create channel" description="Add a channel to this server.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await apiPost(`/api/servers/${serverId}/channels`, {
                name,
                type,
                topic: topic || undefined,
                isPrivate,
              });
              onOpenChange(false);
              setName('');
              toast({ kind: 'success', title: 'Channel created' });
            } catch (err) {
              toast({ kind: 'error', title: 'Could not create channel', description: (err as Error).message });
            }
          }}
        >
          <Field label="Channel name" htmlFor="ch-name">
            <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </Field>
          <Field label="Type">
            <div className="flex gap-2">
              {(['TEXT', 'VOICE', 'ANNOUNCEMENT'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-2 text-sm capitalize',
                    type === t ? 'border-accent bg-accent-soft text-accent' : 'hover:bg-muted/50',
                  )}
                >
                  {t.toLowerCase()}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Topic (optional)" htmlFor="ch-topic">
            <Textarea id="ch-topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} />
          </Field>
          <label className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm">
              Private channel
              <span className="block text-xs text-muted-foreground">Only invited roles/members can see it</span>
            </span>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={!name.trim()}>Create</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  serverId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  serverId: string;
}) {
  const { toast } = useToast();
  const [link, setLink] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await apiPost<{ invite: { url: string; code: string } }>(
          `/api/servers/${serverId}/invites`,
          { maxUses: 25, expiresInHours: 168 },
        );
        setLink(`${window.location.origin}${res.invite.url}`);
      } catch (err) {
        toast({ kind: 'error', title: 'Could not create invite', description: (err as Error).message });
      }
    })();
  }, [open, serverId, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Invite people" description="Share this link — it expires in 7 days (25 uses).">
        <div className="flex gap-2">
          <Input readOnly value={link ?? 'Creating…'} className="font-mono text-xs" />
          <Button
            onClick={() => {
              if (link) {
                void navigator.clipboard.writeText(link);
                toast({ kind: 'success', title: 'Copied to clipboard' });
              }
            }}
          >
            Copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ServerSettingsDialog({
  open,
  onOpenChange,
  server,
  serverId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  server?: ServerDTO;
  serverId: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [name, setName] = React.useState(server?.name ?? '');
  const [description, setDescription] = React.useState(server?.description ?? '');
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const { user } = useAuth();
  const isOwner = Boolean(server?.ownerId && server.ownerId === user?.id);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title="Server settings" description="Update your community's identity.">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await apiPatch(`/api/servers/${serverId}`, {
                  name,
                  description: description || null,
                });
                toast({ kind: 'success', title: 'Server updated' });
                onOpenChange(false);
              } catch (err) {
                toast({ kind: 'error', title: 'Update failed', description: (err as Error).message });
              }
            }}
          >
            <Field label="Server name" htmlFor="set-name">
              <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Description" htmlFor="set-desc">
              <Textarea id="set-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </Field>
            <div className="flex items-center justify-between">
              {isOwner ? (
                <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4" /> Delete server
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this server?"
        description="This permanently deletes the server, all channels and all messages. This cannot be undone."
        confirmLabel="Delete forever"
        destructive
        onConfirm={async () => {
          try {
            await apiDelete(`/api/servers/${serverId}`);
            toast({ kind: 'success', title: 'Server deleted' });
            router.push('/app/friends');
          } catch (err) {
            toast({ kind: 'error', title: 'Delete failed', description: (err as Error).message });
          } finally {
            setDeleteOpen(false);
          }
        }}
      />
    </>
  );
}
