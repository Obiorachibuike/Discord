'use client';

import * as React from 'react';
import { Crown, Shield, Clock, UserX, Ban, UserMinus } from 'lucide-react';
import type { ServerMemberDTO, ServerDTO } from '@aether/shared';
import { Permissions, hasPermission } from '@aether/shared';
import { Avatar, Tooltip } from '@/components/ui/primitives';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/input';

export function MemberList({
  members,
  server,
  loading,
}: {
  members: ServerMemberDTO[];
  server?: ServerDTO;
  loading?: boolean;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const myPerms = BigInt(server?.myPermissions ?? '0');
  const canModerate =
    hasPermission(myPerms, Permissions.KICK_MEMBERS) || hasPermission(myPerms, Permissions.BAN_MEMBERS);

  const online = members.filter((m) => m.user.presenceStatus && m.user.presenceStatus !== 'OFFLINE');
  const offline = members.filter((m) => !m.user.presenceStatus || m.user.presenceStatus === 'OFFLINE');

  const act = async (kind: 'KICK' | 'BAN' | 'TIMEOUT', targetId: string) => {
    try {
      await apiPost('/api/moderation/actions', {
        type: kind,
        serverId: server?.id,
        userId: targetId,
        ...(kind === 'TIMEOUT' ? { durationMinutes: 10, reason: 'Timed out by a moderator' } : {}),
      });
      toast({ kind: 'success', title: `${kind.toLowerCase()} successful` });
    } catch (err) {
      toast({ kind: 'error', title: 'Action failed', description: (err as Error).message });
    }
  };

  const renderMember = (m: ServerMemberDTO) => {
    const isOwner = server?.ownerId === m.userId;
    const isSelf = m.userId === user?.id;
    return (
      <DropdownMenu key={m.userId}>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/50">
            <Avatar
              name={m.nickname ?? m.user.displayName}
              src={m.user.avatarUrl}
              size="sm"
              status={m.user.presenceStatus}
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate text-sm font-medium">
                {m.nickname ?? m.user.displayName}
                {isOwner ? <Crown className="h-3 w-3 text-warning" /> : null}
                {m.timeoutUntil && new Date(m.timeoutUntil) > new Date() ? (
                  <Tooltip label="Timed out">
                    <Clock className="h-3 w-3 text-warning" />
                  </Tooltip>
                ) : null}
              </p>
              {m.user.customStatus ? (
                <p className="truncate text-[11px] text-muted-foreground">{m.user.customStatus}</p>
              ) : null}
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <div className="px-2 py-1.5">
            <p className="text-sm font-semibold">{m.user.displayName}</p>
            <p className="text-xs text-muted-foreground">@{m.user.username}</p>
          </div>
          <DropdownMenuSeparator />
          {canModerate && !isSelf && !isOwner ? (
            <>
              <DropdownMenuItem onSelect={() => void act('TIMEOUT', m.userId)}>
                <Clock className="h-4 w-4" /> Timeout (10 min)
              </DropdownMenuItem>
              {hasPermission(myPerms, Permissions.KICK_MEMBERS) ? (
                <DropdownMenuItem destructive onSelect={() => void act('KICK', m.userId)}>
                  <UserMinus className="h-4 w-4" /> Kick from server
                </DropdownMenuItem>
              ) : null}
              {hasPermission(myPerms, Permissions.BAN_MEMBERS) ? (
                <DropdownMenuItem destructive onSelect={() => void act('BAN', m.userId)}>
                  <Ban className="h-4 w-4" /> Ban from server
                </DropdownMenuItem>
              ) : null}
            </>
          ) : isSelf ? null : (
            <DropdownMenuItem>
              <Shield className="h-4 w-4" /> {m.roleIds.length ? 'Member' : 'No actions'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <aside className="hidden h-full w-56 shrink-0 flex-col overflow-y-auto border-l bg-surface px-2 py-4 scroll-thin lg:flex">
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Online — {online.length}
          </p>
          {online.map(renderMember)}
          {offline.length > 0 ? (
            <>
              <p className="mb-2 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Offline — {offline.length}
              </p>
              <div className="opacity-60">{offline.map(renderMember)}</div>
            </>
          ) : null}
        </>
      )}
      <div className="mt-auto px-2 pt-4 text-[10px] text-muted-foreground">
        <UserX className="mr-1 inline h-3 w-3" />
        Right-click (long-press) a member for moderation actions
      </div>
    </aside>
  );
}
