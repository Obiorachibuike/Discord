'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  useConversation,
  useConversationMessages,
  useSendConversationMessage,
  useConversationSocket,
  useUpdateConversationName,
  useLeaveConversation,
  useMarkConversationRead,
  flattenMessages,
} from '@/lib/hooks';
import { MessageView } from '@/components/chat/message-view';
import { Avatar } from '@/components/ui/primitives';
import { Spinner, Button, Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ConfirmDialog,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { MoreHorizontal, Pencil, Trash2, Users } from 'lucide-react';

export default function ConversationPage() {
  const params = useParams<{ conversationId: string }>();
  const { conversationId } = params;
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { data: convData, isLoading: convLoading } = useConversation(conversationId);
  const {
    data: messagesData,
    isLoading: msgsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useConversationMessages(conversationId);
  const send = useSendConversationMessage(conversationId);
  const { typingUsers, startTyping, stopTyping } = useConversationSocket(conversationId);
  const rename = useUpdateConversationName();
  const leave = useLeaveConversation();
  const markRead = useMarkConversationRead(conversationId);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState('');
  const [leaveOpen, setLeaveOpen] = React.useState(false);

  // Mark the conversation read when opened / when new messages arrive.
  const lastId = messagesData?.pages[0]?.items.at(-1)?.id;
  React.useEffect(() => {
    if (lastId) markRead.mutate();
  }, [lastId]);

  const conv = convData?.conversation;
  const messages = flattenMessages(messagesData);

  if (!conv) {
    return (
      <div className="flex flex-1 items-center justify-center">
        {convLoading ? (
          <Spinner className="h-8 w-8" />
        ) : (
          <p className="text-sm text-muted-foreground">Conversation not found.</p>
        )}
      </div>
    );
  }

  const other = conv.members.find((m) => m.id !== user?.id);
  const title = conv.name ?? other?.displayName ?? 'Conversation';

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-11 items-center gap-2 border-b px-4">
        <Avatar
          name={title}
          src={other?.avatarUrl}
          size="xs"
          status={other?.presenceStatus}
        />
        <h1 className="font-semibold">{title}</h1>
        {conv.type === 'GROUP' ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> {conv.members.length} members
          </span>
        ) : null}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50"
                aria-label="Conversation options"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {conv.type === 'GROUP' ? (
                <DropdownMenuItem
                  onSelect={() => {
                    setRenameValue(conv.name ?? '');
                    setRenameOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" /> Rename conversation
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                destructive
                onSelect={() => setLeaveOpen(true)}
              >
                <Trash2 className="h-4 w-4" /> Leave conversation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <MessageView
        messages={messages}
        loading={msgsLoading || isFetchingNextPage}
        currentUserId={user?.id ?? ''}
        onSend={(input) => send.mutateAsync(input)}
        onTypingStart={startTyping}
        onTypingStop={stopTyping}
        typingUsers={typingUsers}
        placeholder={`Message ${title}`}
        emptyTitle={`Say hello to ${title}`}
        emptyDescription="This is the beginning of your conversation. Messages are delivered in real time."
        onRefresh={() => void refetch()}
        header={
          hasNextPage ? (
            <button
              onClick={() => fetchNextPage()}
              className="mx-auto rounded-full border bg-surface px-4 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Load earlier messages
            </button>
          ) : null
        }
      />

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm" title="Rename conversation">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Conversation name"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                try {
                  await rename.mutateAsync({ conversationId, name: renameValue });
                  setRenameOpen(false);
                  toast({ kind: 'success', title: 'Conversation renamed' });
                } catch (err) {
                  toast({
                    kind: 'error',
                    title: 'Rename failed',
                    description: err instanceof Error ? err.message : undefined,
                  });
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Leave conversation?"
        description="You will stop receiving messages from this conversation. You can be re-added later."
        confirmLabel="Leave"
        destructive
        onConfirm={async () => {
          try {
            await leave.mutateAsync(conversationId);
            toast({ kind: 'success', title: 'Left conversation' });
            router.replace('/app/friends');
          } catch (err) {
            toast({
              kind: 'error',
              title: 'Could not leave',
              description: err instanceof Error ? err.message : undefined,
            });
          }
        }}
      />
    </div>
  );
}
