'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  useServer,
  useChannels,
  useMembers,
  useChannelMessages,
  useSendMessage,
  useChannelSocket,
  flattenMessages,
} from '@/lib/hooks';
import { MessageView } from '@/components/chat/message-view';
import { MemberList } from '@/components/layout/member-list';
import { VoicePanel } from '@/components/voice/voice-panel';
import { Spinner } from '@/components/ui/input';
import { PanelRightClose, PanelRightOpen, Hash, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { Permissions, hasPermission, type ChannelDTO } from '@aether/shared';

export default function ChannelPage() {
  const params = useParams<{ serverId: string; channelId: string }>();
  const { serverId, channelId } = params;
  const { user } = useAuth();
  const { data: serverData, isLoading: serverLoading } = useServer(serverId);
  const { data: channelsData } = useChannels(serverId);
  const { data: membersData, isLoading: membersLoading } = useMembers(serverId);
  const {
    data: messagesData,
    isLoading: msgsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useChannelMessages(channelId);
  const send = useSendMessage(channelId);
  const { typingUsers, startTyping, stopTyping } = useChannelSocket(channelId);
  const [showMembers, setShowMembers] = React.useState(true);

  const server = serverData?.server;
  const allChannels: ChannelDTO[] = [
    ...(channelsData?.uncategorized ?? []),
    ...(channelsData?.categories ?? []).flatMap((c) => c.channels),
  ];
  const channel = allChannels.find((c) => c.id === channelId);
  const messages = flattenMessages(messagesData);
  const myPerms = BigInt(server?.myPermissions ?? '0');

  if (!channel && (serverLoading || !channelsData)) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Channel not found — or you don&apos;t have access to it.
      </div>
    );
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 items-center gap-2 border-b px-4">
          {channel.type === 'VOICE' ? (
            <Volume2 className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Hash className="h-4 w-4 text-muted-foreground" />
          )}
          <h1 className="font-semibold">{channel.name}</h1>
          {channel.topic ? (
            <>
              <div className="mx-2 h-5 w-px bg-border" />
              <p className="truncate text-xs text-muted-foreground">{channel.topic}</p>
            </>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setShowMembers((v) => !v)}
              className={cn(
                'rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                showMembers && 'text-foreground',
              )}
              aria-label="Toggle member list"
            >
              {showMembers ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {channel.type === 'VOICE' ? (
          <VoicePanel channelId={channelId} channelName={channel.name} />
        ) : (
          <MessageView
            messages={messages}
            loading={msgsLoading || isFetchingNextPage}
            currentUserId={user?.id ?? ''}
            canManageMessages={
              server ? hasPermission(myPerms, Permissions.MANAGE_MESSAGES) : false
            }
            onSend={(input) => send.mutateAsync(input)}
            onTypingStart={startTyping}
            onTypingStop={stopTyping}
            typingUsers={typingUsers}
            placeholder={`Message #${channel.name}`}
            emptyTitle={`Welcome to #${channel.name}!`}
            emptyDescription={`This is the start of the #${channel.name} channel.${
              channel.topic ? ` ${channel.topic}` : ''
            }`}
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
        )}
      </div>

      {showMembers ? (
        <MemberList
          members={membersData?.members ?? []}
          server={server}
          loading={membersLoading}
        />
      ) : null}
    </>
  );
}
