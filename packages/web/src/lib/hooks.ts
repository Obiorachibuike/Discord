'use client';

import * as React from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  ChannelDTO,
  ConversationDTO,
  FriendDTO,
  MessageDTO,
  NotificationDTO,
  PublicUserDTO,
  RoleDTO,
  SelfUserDTO,
  ServerDTO,
  ServerMemberDTO,
} from '@aether/shared';
import { api, apiDelete, apiGet, apiPatch, apiPost } from './api';
import { getSocket } from './socket';
import { uniqueClientId } from './utils';

// ─── Servers ─────────────────────────────────────────────────────────────────

export function useServers(): UseQueryResult<{ servers: ServerDTO[] }> {
  return useQuery({
    queryKey: ['servers'],
    queryFn: () => apiGet<{ servers: ServerDTO[] }>('/api/servers'),
  });
}

export function useServer(serverId: string | undefined) {
  return useQuery({
    queryKey: ['server', serverId],
    queryFn: () => apiGet<{ server: ServerDTO }>(`/api/servers/${serverId}`),
    enabled: Boolean(serverId),
  });
}

export function useServerRoles(serverId: string | undefined) {
  return useQuery({
    queryKey: ['roles', serverId],
    queryFn: () => apiGet<{ roles: RoleDTO[] }>(`/api/servers/${serverId}/roles`),
    enabled: Boolean(serverId),
  });
}

export interface ChannelListResponse {
  categories: { id: string; name: string; position: number; channels: ChannelDTO[] }[];
  uncategorized: ChannelDTO[];
  canManage: boolean;
}

export function useChannels(serverId: string | undefined) {
  return useQuery({
    queryKey: ['channels', serverId],
    queryFn: () => apiGet<ChannelListResponse>(`/api/servers/${serverId}/channels`),
    enabled: Boolean(serverId),
  });
}

export function useMembers(serverId: string | undefined) {
  return useQuery({
    queryKey: ['members', serverId],
    queryFn: () =>
      apiGet<{ members: ServerMemberDTO[]; nextCursor: string | null }>(
        `/api/servers/${serverId}/members?limit=100`,
      ),
    enabled: Boolean(serverId),
  });
}

export function useCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      apiPost<{ server: ServerDTO }>('/api/servers', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  });
}

export function useCreateInvite(serverId: string | undefined) {
  return useMutation({
    mutationFn: (body: { maxUses?: number; expiresAt?: string | null }) =>
      apiPost<{ invite: { code: string; url?: string } }>(`/api/servers/${serverId}/invites`, body),
  });
}

export function useLeaveServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) => apiPost(`/api/servers/${serverId}/leave`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  });
}

// ─── Messages (infinite history; newest window first, older pages follow) ────

export interface MessagePage {
  items: MessageDTO[];
  nextCursor: string | null;
}

export interface InfiniteMessages {
  pages: MessagePage[];
  pageParams: unknown[];
}

/** Transcript order (oldest→newest) from any pages shape. */
export function flattenMessages(data: InfiniteMessages | undefined): MessageDTO[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((p) => p.items);
}

function appendToNewestPage(old: InfiniteMessages | undefined, message: MessageDTO): InfiniteMessages {
  if (!old || old.pages.length === 0) {
    return { pages: [{ items: [message], nextCursor: null }], pageParams: [undefined] };
  }
  const pages = [...old.pages];
  pages[0] = { ...pages[0]!, items: [...pages[0]!.items, message] };
  return { ...old, pages };
}

export function useChannelMessages(channelId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['messages', 'channel', channelId],
    queryFn: ({ pageParam }) =>
      apiGet<MessagePage>(
        `/api/channels/${channelId}/messages?limit=50&direction=before${
          pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : ''
        }`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: MessagePage) => last.nextCursor ?? undefined,
    enabled: Boolean(channelId),
  });
}

export function useConversationMessages(conversationId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['messages', 'conversation', conversationId],
    queryFn: ({ pageParam }) =>
      apiGet<MessagePage>(
        `/api/conversations/${conversationId}/messages?limit=50${
          pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : ''
        }`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: MessagePage) => last.nextCursor ?? undefined,
    enabled: Boolean(conversationId),
  });
}

export function useSendMessage(channelId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      content?: string;
      replyToId?: string | null;
      attachmentIds?: string[];
    }) => {
      const clientId = uniqueClientId();
      return apiPost<{ message: MessageDTO }>('/api/messages', {
        channelId,
        clientId,
        ...input,
      });
    },
    onSuccess: (data) => {
      qc.setQueryData<InfiniteMessages>(['messages', 'channel', channelId], (old) =>
        old && old.pages.some((p) => p.items.some((m) => m.id === data.message.id))
          ? old
          : appendToNewestPage(old, data.message),
      );
    },
  });
}

export function useSendConversationMessage(conversationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      content?: string;
      replyToId?: string | null;
      attachmentIds?: string[];
    }) => {
      const clientId = uniqueClientId();
      return apiPost<{ message: MessageDTO }>(`/api/conversations/${conversationId}/messages`, {
        clientId,
        ...input,
      });
    },
    onSuccess: (data) => {
      qc.setQueryData<InfiniteMessages>(['messages', 'conversation', conversationId], (old) =>
        old && old.pages.some((p) => p.items.some((m) => m.id === data.message.id))
          ? old
          : appendToNewestPage(old, data.message),
      );
    },
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => apiDelete(`/api/messages/${messageId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }),
  });
}

export function useReactToMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      apiPost(`/api/messages/${messageId}/reactions`, { emoji }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }),
  });
}

// ─── Conversations & friends ─────────────────────────────────────────────────

export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiGet<{ conversations: ConversationDTO[] }>('/api/conversations'),
  });
}

export function useConversation(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => apiGet<{ conversation: ConversationDTO }>(`/api/conversations/${conversationId}`),
    enabled: Boolean(conversationId),
  });
}

export function useStartDm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string }) =>
      apiPost<{ conversation: ConversationDTO }>('/api/conversations/dm', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; memberIds: string[] }) =>
      apiPost<{ conversation: ConversationDTO }>('/api/conversations/group', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useUpdateConversationName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, name }: { conversationId: string; name: string }) =>
      apiPatch<{ conversation: ConversationDTO }>(`/api/conversations/${conversationId}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation'] });
    },
  });
}

export function useLeaveConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiDelete(`/api/conversations/${conversationId}/members/me`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation'] });
    },
  });
}

export function useMarkConversationRead(conversationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/api/conversations/${conversationId}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export interface FriendsResponse {
  friends: FriendDTO[];
  incoming: FriendDTO[];
  outgoing: FriendDTO[];
}

export function useFriends(): UseQueryResult<FriendsResponse> {
  return useQuery({
    queryKey: ['friends'],
    queryFn: () => apiGet<FriendsResponse>('/api/friends'),
  });
}

export function useBlocks() {
  return useQuery({
    queryKey: ['friends', 'blocks'],
    queryFn: () => apiGet<{ blocked: PublicUserDTO[] }>('/api/friends/blocks'),
  });
}

export function useSendFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { username: string }) => apiPost('/api/friends/requests', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
}

export function useAcceptFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId }: { requestId: string }) =>
      apiPost(`/api/friends/requests/${requestId}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
}

export function useDeclineFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId }: { requestId: string }) =>
      apiPost(`/api/friends/requests/${requestId}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
}

export function useRemoveFriend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => apiDelete(`/api/friends/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId }: { userId: string }) => apiPost('/api/friends/blocks', { userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['conversation'] });
    },
  });
}

export function useUnblockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId }: { userId: string }) => apiDelete(`/api/friends/blocks/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
}

// ─── User profile & account ──────────────────────────────────────────────────

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { displayName?: string; bio?: string | null; customStatus?: string | null }) =>
      apiPatch<{ user: SelfUserDTO }>('/api/users/me', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      username?: string;
      currentPassword?: string;
      newPassword?: string;
    }) => apiPatch<{ user: SelfUserDTO }>('/api/users/me/account', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) =>
      api<{ user: SelfUserDTO }>('/api/users/me/avatar', { method: 'POST', formData: form }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => apiDelete('/api/users/me'),
  });
}

// ─── Notifications ───────────────────────────────────────────────────────────

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiGet<{ notifications: NotificationDTO[]; unread: number }>('/api/notifications'),
    refetchInterval: 60_000,
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/api/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ─── Search ──────────────────────────────────────────────────────────────────

export function useSearchMessages(query: string, serverId?: string) {
  return useQuery({
    queryKey: ['search', query, serverId],
    queryFn: () =>
      apiGet<{ items: MessageDTO[]; nextCursor: string | null }>(
        `/api/search/messages?q=${encodeURIComponent(query)}${serverId ? `&serverId=${serverId}` : ''}`,
      ),
    enabled: query.trim().length >= 2,
  });
}

// ─── Realtime wiring ─────────────────────────────────────────────────────────

function mapAllMessagePages(
  qc: ReturnType<typeof useQueryClient>,
  fn: (m: MessageDTO) => MessageDTO | null,
) {
  for (const key of [
    ['messages', 'channel'],
    ['messages', 'conversation'],
  ] as const) {
    qc.setQueriesData<InfiniteMessages>({ queryKey: key }, (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          items: p.items.flatMap((m) => {
            const next = fn(m);
            return next ? [next] : [];
          }),
        })),
      };
    });
  }
}

/**
 * Connects the Socket.IO client and keeps query caches fresh from server
 * events. Mounted once inside the authenticated app shell.
 */
export function useRealtime(): {
  connected: boolean;
} {
  const qc = useQueryClient();
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onMessageCreated = (message: MessageDTO) => {
      const key = message.channelId
        ? (['messages', 'channel', message.channelId] as const)
        : (['messages', 'conversation', message.conversationId ?? ''] as const);
      qc.setQueryData<InfiniteMessages>([...key], (old) => {
        if (old && old.pages.some((p) => p.items.some((m) => m.id === message.id))) return old;
        return appendToNewestPage(old, message);
      });
      if (message.conversationId) {
        qc.invalidateQueries({ queryKey: ['conversations'] });
      }
    };

    const onMessageUpdated = (message: Partial<MessageDTO> & { id: string }) => {
      mapAllMessagePages(qc, (m) => (m.id === message.id ? { ...m, ...message } : m));
    };

    const onMessageDeleted = (payload: { id: string; channelId?: string | null }) => {
      mapAllMessagePages(qc, (m) => (m.id === payload.id ? null : m));
    };

    const onPresence = () => {
      qc.invalidateQueries({ queryKey: ['members'] });
      qc.invalidateQueries({ queryKey: ['friends'] });
    };

    const onNotification = () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    };

    const onFriend = () => {
      qc.invalidateQueries({ queryKey: ['friends'] });
    };

    const onConversation = () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
    };

    const onChannel = () => {
      qc.invalidateQueries({ queryKey: ['channels'] });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('message:created', onMessageCreated);
    socket.on('message:updated', onMessageUpdated);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('presence:update', onPresence);
    socket.on('notification:new', onNotification);
    socket.on('friend:request', onFriend);
    socket.on('friend:updated', onFriend);
    socket.on('conversation:updated', onConversation);
    socket.on('conversation:created', onConversation);
    socket.on('channel:updated', onChannel);
    socket.on('channel:deleted', onChannel);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('message:created', onMessageCreated);
      socket.off('message:updated', onMessageUpdated);
      socket.off('message:deleted', onMessageDeleted);
      socket.off('presence:update', onPresence);
      socket.off('notification:new', onNotification);
      socket.off('friend:request', onFriend);
      socket.off('friend:updated', onFriend);
      socket.off('conversation:updated', onConversation);
      socket.off('conversation:created', onConversation);
      socket.off('channel:updated', onChannel);
      socket.off('channel:deleted', onChannel);
    };
  }, [qc]);

  return { connected };
}

/** Subscribes to a channel room and returns typing users. */
export function useChannelSocket(channelId: string | undefined) {
  const [typing, setTyping] = React.useState<Map<string, string>>(new Map());

  React.useEffect(() => {
    if (!channelId) return;
    const socket = getSocket();
    socket.emit('channel:subscribe', { channelId });
    const onTyping = (p: {
      userId: string;
      displayName: string;
      typing: boolean;
      channelId?: string;
    }) => {
      if (p.channelId !== channelId) return;
      setTyping((prev) => {
        const next = new Map(prev);
        if (p.typing) next.set(p.userId, p.displayName);
        else next.delete(p.userId);
        return next;
      });
    };
    socket.on('typing:changed', onTyping);
    return () => {
      socket.emit('channel:unsubscribe', { channelId });
      socket.off('typing:changed', onTyping);
      setTyping(new Map());
    };
  }, [channelId]);

  return {
    typingUsers: [...typing.values()],
    startTyping: () => channelId && getSocket().emit('typing:start', { channelId }),
    stopTyping: () => channelId && getSocket().emit('typing:stop', { channelId }),
  };
}

export function useConversationSocket(conversationId: string | undefined) {
  const [typing, setTyping] = React.useState<Map<string, string>>(new Map());

  React.useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    socket.emit('conversation:subscribe', { conversationId });
    const onTyping = (p: {
      userId: string;
      displayName: string;
      typing: boolean;
      conversationId?: string;
    }) => {
      if (p.conversationId !== conversationId) return;
      setTyping((prev) => {
        const next = new Map(prev);
        if (p.typing) next.set(p.userId, p.displayName);
        else next.delete(p.userId);
        return next;
      });
    };
    socket.on('typing:changed', onTyping);
    return () => {
      socket.emit('conversation:unsubscribe', { conversationId });
      socket.off('typing:changed', onTyping);
    };
  }, [conversationId]);

  return {
    typingUsers: [...typing.values()],
    startTyping: () =>
      conversationId && getSocket().emit('conversation:typing:start', { conversationId }),
    stopTyping: () =>
      conversationId && getSocket().emit('conversation:typing:stop', { conversationId }),
  };
}

// ─── Misc mutations ──────────────────────────────────────────────────────────

export function useJoinInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => apiPost<{ serverId: string }>(`/api/invites/${code}/join`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  });
}

export function useUpload() {
  return useMutation({
    mutationFn: (form: FormData) =>
      api<{ attachment: { id: string; url: string; fileName: string } }>('/api/uploads', {
        method: 'POST',
        formData: form,
      }),
  });
}
