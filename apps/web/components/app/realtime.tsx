'use client';
import { useEffect, useState } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import type { Message } from '@/lib/types';
type Page = { messages: Message[]; nextCursor: string | null };
type Target = { kind: 'channel'|'conversation'; id: string } | null;
export function useRealtime(userId: string | undefined, serverId: string | undefined, target: Target) {
  const client = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connection, setConnection] = useState<'connecting'|'connected'|'offline'>('connecting');
  const [typing, setTyping] = useState<Record<string, { name?: string; expires: number }>>({});
  useEffect(() => {
    if (!userId) return;
    const instance = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnection: true, reconnectionDelayMax: 5000 });
    setSocket(instance);
    const onMessage = (message: Message) => {
      const kind = message.channelId ? 'channel' : 'conversation'; const id = message.channelId || message.conversationId;
      if (!id) return;
      client.setQueryData<InfiniteData<Page>>(['messages', kind, id], current => {
        if (!current || current.pages.some(page => page.messages.some(m => m.id === message.id))) return current;
        const pages = [...current.pages];
        pages[0] = { ...pages[0], messages: [message, ...pages[0].messages] };
        return { ...current, pages };
      });
      client.invalidateQueries({ queryKey: ['conversations'] });
    };
    const updateMessage = (message: Message) => client.setQueriesData<InfiniteData<Page>>({ queryKey: ['messages'] }, old => old && ({ ...old, pages: old.pages.map(page => ({ ...page, messages: page.messages.map(m => m.id === message.id ? message : m) })) }));
    const deleteMessage = ({ id }: { id: string }) => client.setQueriesData<InfiniteData<Page>>({ queryKey: ['messages'] }, old => old && ({ ...old, pages: old.pages.map(page => ({ ...page, messages: page.messages.map(m => m.id === id ? { ...m, content: '', deletedAt: new Date().toISOString(), attachments: [] } : m) })) }));
    const reactions = ({ messageId, reactions }: { messageId: string; reactions: Message['reactions'] }) => client.setQueriesData<InfiniteData<Page>>({ queryKey: ['messages'] }, old => old && ({ ...old, pages: old.pages.map(page => ({ ...page, messages: page.messages.map(m => m.id === messageId ? { ...m, reactions } : m) })) }));
    instance.on('connect', () => setConnection('connected'));
    instance.on('disconnect', () => setConnection('offline'));
    instance.on('connect_error', () => setConnection('offline'));
    instance.on('message:created', onMessage);
    instance.on('message:updated', updateMessage);
    instance.on('message:deleted', deleteMessage);
    instance.on('reaction:updated', reactions);
    instance.on('friend:updated', () => { client.invalidateQueries({ queryKey: ['friends'] }); client.invalidateQueries({ queryKey: ['conversations'] }); });
    instance.on('membership:changed', () => { client.invalidateQueries({ queryKey: ['servers'] }); client.invalidateQueries({ queryKey: ['server'] }); client.invalidateQueries({ queryKey: ['members'] }); });
    instance.on('conversation:updated', () => client.invalidateQueries({ queryKey: ['conversations'] }));
    instance.on('notification:new', () => client.invalidateQueries({ queryKey: ['notifications'] }));
    instance.on('presence:updated', () => client.invalidateQueries({ queryKey: ['presences'] }));
    instance.on('session:revoked', ({ sessionId, all }: { sessionId?: string; all?: boolean }) => { if (all || sessionId) { client.clear(); window.location.assign('/login'); } });
    instance.on('typing:updated', (event: { userId: string; targetId: string; typing: boolean }) => setTyping(old => {
      const key = `${event.targetId}:${event.userId}`; const next = { ...old };
      if (event.typing) next[key] = { expires: Date.now() + 4000 }; else delete next[key];
      return next;
    }));
    const interval = setInterval(() => { if (instance.connected) instance.emit('presence:heartbeat', {}, () => {});
      setTyping(old => Object.fromEntries(Object.entries(old).filter(([, value]) => value.expires > Date.now())));
    }, 20_000);
    return () => { clearInterval(interval); instance.disconnect(); setSocket(null); };
  }, [userId, client]);
  useEffect(() => {
    if (!socket) return;
    const subscribe = () => {
      if (serverId) socket.emit('server:subscribe', { serverId }, () => {});
      if (target) socket.emit(`${target.kind}:subscribe`, { [`${target.kind}Id`]: target.id }, () => {});
    };
    if (socket.connected) subscribe();
    socket.on('connect', subscribe);
    return () => {
      socket.off('connect', subscribe);
      if (target) socket.emit(`${target.kind}:unsubscribe`, { [`${target.kind}Id`]: target.id }, () => {});
    };
  }, [socket, serverId, target?.kind, target?.id]);
  return { socket, connection, typing };
}
