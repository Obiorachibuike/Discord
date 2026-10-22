'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Crown, MoreHorizontal, Users, X } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { Conversation, Member, Server, User } from '@/lib/types';
import { api, json } from '@/lib/api';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type Role = { id: string; name: string; isManaged: boolean; isDefault: boolean };
type MemberView = { user: User; roles: Member['roles']; timedOutUntil?: string | null };

export function MembersPanel({ server, conversation, me, onClose, mobile = false }: { server?: Server | null; conversation?: Conversation; me: User; onClose: () => void; mobile?: boolean }) {
  const client = useQueryClient();
  const members = useQuery({ queryKey: ['members', server?.id], queryFn: () => api<{ members: Member[] }>(`/servers/${server!.id}/members?limit=50`), enabled: !!server });
  const roles = useQuery({ queryKey: ['roles', server?.id], queryFn: () => api<{ roles: Role[] }>(`/servers/${server!.id}/roles`), enabled: !!server?.myPermissions.includes('MANAGE_ROLES') });
  const presences = useQuery({ queryKey: ['presences', server?.id, members.data?.members.map(m => m.user.id).join(',')], queryFn: () => api<{ presences: Record<string, User['presence']> }>(`/presence?ids=${members.data!.members.map(m => m.user.id).join(',')}`), enabled: !!server && !!members.data?.members.length, refetchInterval: 60_000 });
  const users: MemberView[] = server ? members.data?.members || [] : conversation?.members.map(user => ({ user, roles: [] })) || [];
  const online = users.filter(m => (presences.data?.presences[m.user.id] || m.user.presence) !== 'OFFLINE');
  const offline = users.filter(m => (presences.data?.presences[m.user.id] || m.user.presence) === 'OFFLINE');
  async function moderate(userId: string, action: 'kick'|'ban'|'timeout') {
    if (!server || !window.confirm(`${action === 'timeout' ? 'Timeout' : action === 'ban' ? 'Ban' : 'Kick'} this member?`)) return;
    try {
      await api(`/servers/${server.id}/members/${userId}/${action}`, { method: 'POST', body: json(action === 'timeout' ? { minutes: 60, reason: 'Moderation action' } : { reason: 'Moderation action' }) });
      await client.invalidateQueries({ queryKey: ['members', server.id] });
      toast.success('Moderation action applied.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not moderate member.'); }
  }
  async function toggleRole(userId: string, roleId: string, assigned: boolean) {
    if (!server) return;
    try {
      await api(`/servers/${server.id}/members/${userId}/roles/${roleId}`, { method: assigned ? 'DELETE' : 'PUT', ...(!assigned ? { body: '{}' } : {}) });
      await client.invalidateQueries({ queryKey: ['members', server.id] });
      toast.success(assigned ? 'Role removed.' : 'Role assigned.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update this role.'); }
  }
  const item = (member: MemberView, presence: User['presence']) => <MemberItem key={member.user.id} member={member} presence={presence} me={me} server={server} roles={roles.data?.roles || []} onModerate={moderate} onRole={toggleRole}/>;
  return <aside className={cn('flex h-full w-[245px] shrink-0 flex-col border-l border-line/65 bg-panel', mobile && 'w-[min(300px,85vw)]')} aria-label="Members">
    <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-line/65 px-4"><div><p className="text-sm font-bold">People here</p><p className="text-[11px] text-subtle">{server ? `${server._count.members} members` : `${users.length} people`}</p></div><button onClick={onClose} aria-label="Close members panel" className="rounded-lg p-1.5 text-subtle hover:bg-muted hover:text-ink"><X size={18}/></button></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-5">
      {members.isLoading && server && [1,2,3].map(n => <div key={n} className="flex gap-2 px-2 py-3"><Skeleton className="h-9 w-9"/><Skeleton className="h-3 w-28"/></div>)}
      {users.length > 0 && <><p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[.12em] text-subtle">ONLINE — {online.length}</p>{online.map(m => item(m, presences.data?.presences[m.user.id] || m.user.presence))}<p className="mb-2 mt-5 px-2 text-[10px] font-bold uppercase tracking-[.12em] text-subtle">OFFLINE — {offline.length}</p>{offline.map(m => item(m, 'OFFLINE'))}</>}
      {!users.length && !members.isLoading && <div className="py-10 text-center text-xs text-subtle"><Users size={22} className="mx-auto mb-3"/>No one here yet.</div>}
    </div>
  </aside>;
}
function MemberItem({ member, presence, me, server, roles, onModerate, onRole }: {
  member: MemberView; presence: User['presence']; me: User; server?: Server | null; roles: Role[];
  onModerate: (id: string, action: 'kick'|'ban'|'timeout') => void;
  onRole: (userId: string, roleId: string, assigned: boolean) => void;
}) {
  const isOwner = server?.ownerId === member.user.id;
  const permissions = server?.myPermissions || [];
  const canManage = !!server && me.id !== member.user.id && !isOwner && permissions.some(p => ['KICK_MEMBERS','BAN_MEMBERS','MODERATE_MEMBERS','MANAGE_ROLES'].includes(p));
  return <div className="group flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-muted/50">
    <Avatar name={member.user.displayName} src={member.user.avatarUrl} status={presence} className="h-9 w-9 rounded-[11px] text-[10px]"/>
    <div className="min-w-0 flex-1"><p className="flex items-center gap-1 truncate text-xs font-semibold">{member.user.displayName}{isOwner && <Crown size={12} className="shrink-0 text-amber-400"/>}</p><p className="truncate text-[10px] text-subtle">{member.timedOutUntil && new Date(member.timedOutUntil) > new Date() ? 'Timed out' : member.user.statusMessage || member.roles[0]?.name || `@${member.user.username}`}</p></div>
    {canManage && <DropdownMenu.Root><DropdownMenu.Trigger aria-label={`Options for ${member.user.displayName}`} className="rounded-lg p-1 text-subtle opacity-0 hover:bg-elevated group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"><MoreHorizontal size={17}/></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-40 max-h-[70vh] min-w-40 overflow-y-auto rounded-xl border border-line bg-elevated p-1.5 text-xs shadow-float">
        {permissions.includes('MANAGE_ROLES') && roles.filter(r => !r.isDefault && !(r.isManaged && r.name === 'Owner')).map(role => {
          const assigned = member.roles.some(r => r.id === role.id);
          return <DropdownMenu.CheckboxItem key={role.id} checked={assigned} onSelect={e => e.preventDefault()} onCheckedChange={() => onRole(member.user.id, role.id, assigned)} className="cursor-pointer rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-muted">{assigned ? '✓ ' : '+ '}{role.name}</DropdownMenu.CheckboxItem>;
        })}
        {permissions.includes('MODERATE_MEMBERS') && <DropdownMenu.Item onSelect={() => onModerate(member.user.id, 'timeout')} className="cursor-pointer rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-muted">Timeout 1 hour</DropdownMenu.Item>}
        {permissions.includes('KICK_MEMBERS') && <DropdownMenu.Item onSelect={() => onModerate(member.user.id, 'kick')} className="cursor-pointer rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-muted">Kick</DropdownMenu.Item>}
        {permissions.includes('BAN_MEMBERS') && <DropdownMenu.Item onSelect={() => onModerate(member.user.id, 'ban')} className="cursor-pointer rounded-lg px-3 py-2 text-rose-400 outline-none data-[highlighted]:bg-muted">Ban</DropdownMenu.Item>}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>}
  </div>;
}
