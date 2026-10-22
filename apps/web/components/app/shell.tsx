'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Compass, Hash, LoaderCircle, Plus, X } from 'lucide-react';
import type { Conversation, Notification, Server, ServerSummary, User } from '@/lib/types';
import { api } from '@/lib/api';
import { ServerRail, ChannelSidebar, MobileSidebar } from './sidebar';
import { CreateServerDialog, CreateChannelDialog, InviteDialog, AddFriendDialog, NewGroupDialog, SearchDialog, ServerSettingsDialog, ChannelSettingsDialog } from './dialogs';
import { ChatWorkspace } from './chat';
import { FriendsWorkspace, useFriends } from './friends';
import { MembersPanel } from './members';
import { CallPanel } from './call';
import { useRealtime } from './realtime';
import { Brand } from '@/components/ui/brand';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
type Target = { kind: 'channel'|'conversation'; id: string } | null;
export function AppShell() {
  const router = useRouter(); const pathname = usePathname(); const params = useParams<{ slug?: string[] }>(); const slug = params.slug || [];
  const serverId = slug[0] === 'servers' ? slug[1] : undefined;
  const channelId = slug[0] === 'servers' && slug[2] === 'channels' ? slug[3] : undefined;
  const conversationId = slug[0] === 'dms' ? slug[1] : undefined;
  const client = useQueryClient();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: User }>('/auth/me'), retry: false });
  const serversQuery = useQuery({ queryKey: ['servers'], queryFn: () => api<{ servers: ServerSummary[] }>('/servers'), enabled: !!meQuery.data });
  const serverQuery = useQuery({ queryKey: ['server', serverId], queryFn: () => api<{ server: Server }>(`/servers/${serverId}`), enabled: !!meQuery.data && !!serverId });
  const conversationsQuery = useQuery({ queryKey: ['conversations'], queryFn: () => api<{ conversations: Conversation[] }>('/social/conversations'), enabled: !!meQuery.data });
  const friendsQuery = useFriends();
  const server = serverQuery.data?.server; const channel = server?.channels.find(c => c.id === channelId);
  const conversation = conversationsQuery.data?.conversations.find(c => c.id === conversationId);
  const target = useMemo<Target>(() => channelId && channel ? { kind: 'channel', id: channelId } : conversationId ? { kind: 'conversation', id: conversationId } : null, [channelId, channel, conversationId]);
  const realtime = useRealtime(meQuery.data?.user.id, serverId, target);
  const [createServer, setCreateServer] = useState(false), [createChannel, setCreateChannel] = useState(false), [invite, setInvite] = useState(false), [addFriend, setAddFriend] = useState(false), [newGroup, setNewGroup] = useState(false);
  const [search, setSearch] = useState(false), [serverSettings, setServerSettings] = useState(false), [channelSettings, setChannelSettings] = useState(false);
  const [mobileNav, setMobileNav] = useState(false), [membersOpen, setMembersOpen] = useState(false), [mobileMembers, setMobileMembers] = useState(false), [notificationsOpen, setNotificationsOpen] = useState(false);
  const [callTarget, setCallTarget] = useState<Target>(null);
  useEffect(() => { if (meQuery.isError && (meQuery.error as { status?: number }).status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`); }, [meQuery.isError, meQuery.error, router, pathname]);
  useEffect(() => { if (serverId && server && !channelId && server.channels.length) {
    const first = server.channels.find(c => c.kind !== 'VOICE') || server.channels[0];
    router.replace(`/app/servers/${server.id}/channels/${first.id}`);
  } }, [serverId, server, channelId, router]);
  useEffect(() => { setCallTarget(null); setMobileNav(false); setMobileMembers(false); }, [target?.kind, target?.id]);
  useEffect(() => { function shortcut(e: KeyboardEvent) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); } }
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ notifications: Notification[]; unreadCount: number }>('/notifications?limit=30'), enabled: !!meQuery.data, refetchInterval: 60_000 });
  if (meQuery.isLoading) return <div className="grid h-[100dvh] place-items-center bg-canvas"><div className="text-center"><div className="mx-auto mb-5"><Brand/></div><LoaderCircle size={22} className="mx-auto animate-spin text-accent"/><p className="mt-3 text-xs text-subtle">Finding your space...</p></div></div>;
  if (!meQuery.data) return <div className="grid h-[100dvh] place-items-center text-sm text-subtle">Redirecting to sign in...</div>;
  const me = meQuery.data.user; const servers = serversQuery.data?.servers || []; const conversations = conversationsQuery.data?.conversations || [];
  const sidebarProps = { server, conversations, currentChannelId: channelId, currentConversationId: conversationId, user: me, onCreateChannel: () => setCreateChannel(true), onInvite: () => setInvite(true), onSettings: () => setServerSettings(true), onNewGroup: () => setNewGroup(true), onCreateServer: () => setCreateServer(true) };
  const content = serverId && serverQuery.isLoading ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-subtle"><LoaderCircle size={18} className="animate-spin text-accent"/> Opening community...</div>
    : serverId && serverQuery.isError ? <div className="flex flex-1 flex-col items-center justify-center text-center"><Compass size={34} className="text-accent"/><h2 className="mt-4 font-display text-xl font-bold">Community not available</h2><p className="mt-2 text-sm text-subtle">You may not have access to this space.</p><Button className="mt-5" onClick={() => router.push('/app')}>Go home</Button></div>
    : callTarget && target && callTarget.id === target.id && callTarget.kind === target.kind ? <CallPanel target={callTarget} title={channel?.name || conversation?.name || conversation?.members.find(m => m.id !== me.id)?.displayName || 'Call'} onLeave={() => setCallTarget(null)}/>
    : target && (channel || conversationId) ? <ChatWorkspace key={`${target.kind}:${target.id}`} target={target} channel={channel} conversation={conversation} server={server} me={me} socket={realtime.socket} connection={realtime.connection} typing={realtime.typing} onMenu={() => setMobileNav(true)} onSearch={() => setSearch(true)} onMembers={() => { if (window.innerWidth < 1024) setMobileMembers(true); else setMembersOpen(!membersOpen); }} onChannelSettings={() => setChannelSettings(true)} onInvite={() => setInvite(true)} onCall={() => setCallTarget(target)}/>
    : server && !server.channels.length ? <div className="flex flex-1 flex-col items-center justify-center px-4 text-center"><Hash size={36} className="text-accent"/><h2 className="mt-4 font-display text-xl font-bold">No channels yet</h2><p className="mt-2 text-sm text-subtle">A conversation just needs a place to start.</p>{server.myPermissions.includes('MANAGE_CHANNELS') && <Button onClick={() => setCreateChannel(true)} className="mt-5"><Plus size={16}/> Create a channel</Button>}</div>
    : <FriendsWorkspace onMenu={() => setMobileNav(true)} onAdd={() => setAddFriend(true)} onGroup={() => setNewGroup(true)} onCreate={() => setCreateServer(true)} hasServers={servers.length > 0}/>;
  async function markAllRead() { try { await api('/notifications/read-all', { method: 'POST', body: '{}' }); await client.invalidateQueries({ queryKey: ['notifications'] }); } catch { toast.error('Could not update notifications.'); } }
  return <div className="relative flex h-[100dvh] min-w-0 overflow-hidden bg-canvas">
    <div className="hidden lg:block"><ServerRail servers={servers} selectedId={serverId} onCreate={() => setCreateServer(true)} onNotifications={() => setNotificationsOpen(true)} unreadCount={notifications.data?.unreadCount}/></div>
    <div className="hidden lg:block"><ChannelSidebar {...sidebarProps}/></div>
    <div className="flex min-w-0 flex-1">{content}</div>
    {membersOpen && target && <div className="hidden xl:block"><MembersPanel server={server} conversation={conversation} me={me} onClose={() => setMembersOpen(false)}/></div>}
    <MobileSidebar open={mobileNav} close={() => setMobileNav(false)}><ServerRail servers={servers} selectedId={serverId} onCreate={() => { setMobileNav(false); setCreateServer(true); }} onNotifications={() => { setMobileNav(false); setNotificationsOpen(true); }} unreadCount={notifications.data?.unreadCount} mobile close={() => setMobileNav(false)}/><ChannelSidebar {...sidebarProps} mobile onClose={() => setMobileNav(false)}/></MobileSidebar>
    {mobileMembers && <div className="fixed inset-0 z-40 flex justify-end bg-black/60 lg:hidden" onClick={() => setMobileMembers(false)}><div onClick={e => e.stopPropagation()}><MembersPanel server={server} conversation={conversation} me={me} mobile onClose={() => setMobileMembers(false)}/></div></div>}
    <CreateServerDialog open={createServer} onChange={setCreateServer}/><CreateChannelDialog open={createChannel} onChange={setCreateChannel} server={server}/><InviteDialog open={invite} onChange={setInvite} server={server}/><AddFriendDialog open={addFriend} onChange={setAddFriend}/><NewGroupDialog open={newGroup} onChange={setNewGroup} friends={friendsQuery.data?.friends || []}/><SearchDialog open={search} onChange={setSearch} server={server}/><ServerSettingsDialog open={serverSettings} onChange={setServerSettings} server={server} meId={me.id}/><ChannelSettingsDialog open={channelSettings} onChange={setChannelSettings} channel={channel} server={server}/>
    {notificationsOpen && <div className="fixed inset-0 z-40" onClick={() => setNotificationsOpen(false)}><div className="absolute bottom-20 left-3 w-[min(360px,calc(100vw-24px))] max-h-[70vh] overflow-y-auto rounded-[18px] border border-line bg-elevated p-4 shadow-float lg:bottom-16 lg:left-20" onClick={e => e.stopPropagation()}><div className="mb-3 flex items-center justify-between"><div><p className="font-display text-base font-bold">Notifications</p><p className="text-[11px] text-subtle">{notifications.data?.unreadCount || 0} unread</p></div><div className="flex gap-2"><button onClick={markAllRead} title="Mark all as read" className="text-xs font-semibold text-accent hover:underline">Read all</button><button onClick={() => setNotificationsOpen(false)} aria-label="Close notifications" className="rounded-lg p-1 text-subtle hover:bg-muted"><X size={17}/></button></div></div><div className="space-y-1">{notifications.data?.notifications.map(n => <button key={n.id} onClick={async () => { await api(`/notifications/${n.id}/read`, { method: 'POST', body: '{}' }).catch(() => {}); client.invalidateQueries({ queryKey: ['notifications'] }); setNotificationsOpen(false); if (n.data.conversationId) router.push(`/app/dms/${n.data.conversationId}`); else if (n.data.channelId && n.data.serverId) router.push(`/app/servers/${n.data.serverId}/channels/${n.data.channelId}`); else if (n.kind.startsWith('FRIEND_')) router.push('/app/friends'); else if (n.kind === 'INVITE' && n.data.serverId) router.push(`/app/servers/${n.data.serverId}`); else toast.info('This notice has no available destination.'); }} className={cn('flex w-full items-start gap-3 rounded-xl p-3 text-left text-xs hover:bg-muted', !n.readAt && 'bg-accent-soft/50')}><Bell size={16} className="mt-0.5 shrink-0 text-accent"/><span><span className="font-bold">{n.kind.replace(/_/g, ' ').toLowerCase()}</span><span className="mt-1 block text-subtle">{new Date(n.createdAt).toLocaleString()}</span></span>{!n.readAt && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent"/>}</button>)}{!notifications.data?.notifications.length && <p className="py-9 text-center text-sm text-subtle">All quiet for now. ✨</p>}</div></div></div>}
  </div>;
}
