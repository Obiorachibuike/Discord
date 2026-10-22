'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  SmilePlus,
  Reply,
  Pin,
  Trash2,
  Pencil,
  MoreHorizontal,
  Paperclip,
  SendHorizontal,
  X,
  FileText,
  Search,
} from 'lucide-react';
import type { MessageDTO } from '@aether/shared';
import { cn, formatDayDivider, formatTime, bytes } from '@/lib/utils';
import { Avatar, Tooltip } from '@/components/ui/primitives';
import { Button, Input, EmptyState, Spinner } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { apiPost, apiDelete, apiPatch, api } from '@/lib/api';

const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

export interface MessageViewProps {
  messages: MessageDTO[];
  loading?: boolean;
  currentUserId: string;
  canManageMessages?: boolean;
  onSend: (input: {
    content?: string;
    replyToId?: string | null;
    attachmentIds?: string[];
  }) => Promise<unknown>;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  typingUsers?: string[];
  header?: React.ReactNode;
  placeholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onRefresh?: () => void;
}

export function MessageView({
  messages,
  loading,
  currentUserId,
  canManageMessages = false,
  onSend,
  onTypingStart,
  onTypingStop,
  typingUsers = [],
  header,
  placeholder = 'Write a message…',
  emptyTitle = 'No messages yet',
  emptyDescription = 'Start the conversation — anything you send appears here instantly.',
  onRefresh,
}: MessageViewProps) {
  const { toast } = useToast();
  const [value, setValue] = React.useState('');
  const [replyTo, setReplyTo] = React.useState<MessageDTO | null>(null);
  const [attachments, setAttachments] = React.useState<{ id: string; name: string; url: string }[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const typingTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages.length]);

  const submit = async () => {
    if ((!value.trim() && attachments.length === 0) || sending) return;
    setSending(true);
    try {
      await onSend({
        content: value.trim() || undefined,
        replyToId: replyTo?.id ?? null,
        attachmentIds: attachments.map((a) => a.id),
      });
      setValue('');
      setReplyTo(null);
      setAttachments([]);
      onTypingStop?.();
    } catch (err) {
      toast({ kind: 'error', title: 'Message failed', description: (err as Error).message });
    } finally {
      setSending(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api<{ attachment: { id: string; url: string; fileName: string } }>(
        '/api/uploads',
        { formData: form },
      );
      setAttachments((prev) => [
        ...prev,
        { id: res.attachment.id, name: res.attachment.fileName, url: res.attachment.url },
      ]);
    } catch (err) {
      toast({ kind: 'error', title: 'Upload failed', description: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {header}
      <div className="flex-1 overflow-y-auto px-4 py-4 scroll-thin">
        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="skeleton h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3 w-32" />
                  <div className="skeleton h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="space-y-0.5">
            {messages.map((m, idx) => {
              const prev = messages[idx - 1];
              const showDivider = !prev || formatDayDivider(prev.createdAt) !== formatDayDivider(m.createdAt);
              const grouped =
                prev &&
                prev.author.id === m.author.id &&
                !m.replyTo &&
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
              return (
                <React.Fragment key={m.id}>
                  {showDivider ? <DayDivider iso={m.createdAt} /> : null}
                  <MessageRow
                    message={m}
                    grouped={Boolean(grouped)}
                    isMe={m.author.id === currentUserId}
                    canManage={canManageMessages}
                    onReply={() => setReplyTo(m)}
                    onEditDone={onRefresh}
                  />
                </React.Fragment>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Typing indicator */}
      <div className="h-6 px-6 text-xs text-muted-foreground">
        {typingUsers.length > 0 ? (
          <span className="animate-fade-in">
            <b>{typingUsers.slice(0, 3).join(', ')}</b>
            {typingUsers.length > 3 ? ' and others' : ''}{' '}
            {typingUsers.length === 1 ? 'is' : 'are'} typing…
          </span>
        ) : null}
      </div>

      {/* Composer */}
      <div className="px-4 pb-4">
        {replyTo ? (
          <div className="flex items-center justify-between rounded-t-md border border-b-0 bg-muted/40 px-3 py-1.5 text-xs">
            <span className="truncate text-muted-foreground">
              Replying to <b className="text-foreground">{replyTo.author.displayName}</b> —{' '}
              {replyTo.content.slice(0, 60)}
            </span>
            <button onClick={() => setReplyTo(null)} aria-label="Cancel reply">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 rounded-t-md border border-b-0 bg-muted/40 p-2">
            {attachments.map((a) => (
              <span key={a.id} className="flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs">
                <Paperclip className="h-3 w-3" /> {a.name}
                <button
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div
          className={cn(
            'flex items-end gap-2 rounded-md border bg-surface p-2',
            (replyTo || attachments.length > 0) && 'rounded-t-none',
          )}
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = '';
            }}
          />
          <Tooltip label="Attach a file" side="top">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              aria-label="Attach file"
            >
              {uploading ? <Spinner /> : <Paperclip className="h-4 w-4" />}
            </button>
          </Tooltip>
          <textarea
            value={value}
            rows={Math.min(6, Math.max(1, value.split('\n').length))}
            onChange={(e) => {
              setValue(e.target.value);
              onTypingStart?.();
              if (typingTimeout.current) clearTimeout(typingTimeout.current);
              typingTimeout.current = setTimeout(() => onTypingStop?.(), 4000);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder}
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            size="icon-sm"
            onClick={() => void submit()}
            disabled={sending || (!value.trim() && attachments.length === 0)}
            aria-label="Send message"
          >
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span className="font-medium">{formatDayDivider(iso)}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function MessageRow({
  message,
  grouped,
  isMe,
  canManage,
  onReply,
  onEditDone,
}: {
  message: MessageDTO;
  grouped: boolean;
  isMe: boolean;
  canManage: boolean;
  onReply: () => void;
  onEditDone?: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(message.content);
  const [hover, setHover] = React.useState(false);

  const react = async (emoji: string) => {
    try {
      await apiPost(`/api/messages/${message.id}/reactions`, { emoji });
    } catch (err) {
      toast({ kind: 'error', title: 'Reaction failed', description: (err as Error).message });
    }
  };

  return (
    <div
      className={cn('group relative rounded-md px-2 hover:bg-muted/30', grouped ? 'py-0.5' : 'mt-2 py-1')}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {message.replyTo ? (
        <div className="mb-0.5 ml-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Reply className="h-3 w-3" />
          <Avatar name={message.replyTo.author.displayName} src={message.replyTo.author.avatarUrl} size="xs" />
          <span className="font-medium text-foreground">{message.replyTo.author.displayName}</span>
          <span className="truncate opacity-80">{message.replyTo.content.slice(0, 80)}</span>
        </div>
      ) : null}
      <div className="flex gap-3">
        {!grouped ? (
          <Avatar name={message.author.displayName} src={message.author.avatarUrl} size="sm" />
        ) : (
          <div className="w-8 shrink-0 text-right text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">
            {formatTime(message.createdAt)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {!grouped ? (
            <div className="flex items-baseline gap-2">
              <Link
                href={`/app/users/${message.author.username}`}
                className="text-sm font-semibold hover:underline"
              >
                {message.author.displayName}
              </Link>
              <span className="text-[10px] text-muted-foreground">{formatTime(message.createdAt)}</span>
              {message.pinned ? <Pin className="h-3 w-3 text-warning" /> : null}
            </div>
          ) : null}
          {editing ? (
            <div className="mt-1">
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    await apiPatch(`/api/messages/${message.id}`, { content: editValue });
                    setEditing(false);
                    onEditDone?.();
                  }
                  if (e.key === 'Escape') setEditing(false);
                }}
                autoFocus
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Escape to cancel • Enter to save
              </p>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {message.content}
              {message.editedAt ? (
                <span className="ml-1 text-[10px] text-muted-foreground">(edited)</span>
              ) : null}
            </p>
          )}
          {message.attachments.length > 0 ? (
            <div className="mt-2 space-y-2">
              {message.attachments.map((a) =>
                a.kind === 'image' ? (
                  <img
                    key={a.id}
                    src={a.url}
                    alt={a.fileName}
                    className="max-h-80 max-w-lg rounded-lg border object-cover"
                    loading="lazy"
                  />
                ) : (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex max-w-sm items-center gap-3 rounded-lg border bg-surface p-3 hover:bg-muted/40"
                  >
                    <FileText className="h-8 w-8 text-accent" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.mimeType} · {bytes(a.fileSize)}
                      </p>
                    </div>
                  </a>
                ),
              )}
            </div>
          ) : null}
          {message.reactions.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {message.reactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() => void react(r.emoji)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                    r.me ? 'border-accent bg-accent-soft' : 'hover:bg-muted/50',
                  )}
                >
                  <span>{r.emoji}</span>
                  <span className="text-muted-foreground">{r.count}</span>
                </button>
              ))}
              <button
                onClick={() => void react(QUICK_EMOJI[Math.floor(Math.random() * QUICK_EMOJI.length)]!)}
                className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted/50 group-hover:opacity-100"
                aria-label="Add reaction"
              >
                <SmilePlus className="h-3 w-3" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Hover actions */}
      {hover && !editing ? (
        <div className="absolute -top-3 right-2 flex items-center gap-0.5 rounded-md border bg-surface-raised p-0.5 shadow-md animate-fade-in">
          <Tooltip label="Add reaction" side="top">
            <button
              onClick={() => void react('👍')}
              className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              aria-label="React"
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip label="Reply" side="top">
            <button
              onClick={onReply}
              className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              aria-label="Reply"
            >
              <Reply className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                aria-label="More"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={async () => {
                  await apiPost(`/api/messages/${message.id}/pin`);
                  toast({ kind: 'success', title: 'Message pinned' });
                }}
              >
                <Pin className="h-4 w-4" /> Pin message
              </DropdownMenuItem>
              {isMe ? (
                <DropdownMenuItem
                  onSelect={() => {
                    setEditValue(message.content);
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-4 w-4" /> Edit message
                </DropdownMenuItem>
              ) : null}
              {isMe || canManage ? (
                <DropdownMenuItem
                  destructive
                  onSelect={async () => {
                    try {
                      await apiDelete(`/api/messages/${message.id}`);
                      toast({ kind: 'success', title: 'Message deleted' });
                      onEditDone?.();
                    } catch (err) {
                      toast({
                        kind: 'error',
                        title: 'Delete failed',
                        description: (err as Error).message,
                      });
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Delete message
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}

export function SearchOverlay({
  open,
  onClose,
  serverId,
}: {
  open: boolean;
  onClose: () => void;
  serverId?: string;
}) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<MessageDTO[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setQ('');
      setResults(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (q.trim().length < 2) return;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search/messages?q=${encodeURIComponent(q)}${serverId ? `&serverId=${serverId}` : ''}`,
          { credentials: 'include' },
        );
        const data = (await res.json()) as { items: MessageDTO[] };
        setResults(data.items);
      } catch {
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, serverId]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh] animate-fade-in">
      <div className="w-full max-w-xl rounded-lg border bg-surface-raised shadow-2xl">
        <div className="flex items-center gap-2 border-b p-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder="Search messages…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2 scroll-thin">
          {busy ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : results?.length ? (
            results.map((m) => (
              <div key={m.id} className="rounded-md p-2.5 hover:bg-muted/40">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Avatar name={m.author.displayName} src={m.author.avatarUrl} size="xs" />
                  <b className="text-foreground">{m.author.displayName}</b>
                  <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm">{m.content}</p>
              </div>
            ))
          ) : q.trim().length >= 2 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No results</p>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
