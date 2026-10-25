'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useServer, useChannels } from '@/lib/hooks';
import { Spinner } from '@/components/ui/input';
import type { ChannelDTO } from '@aether/shared';

/** /app/servers/:id → first available channel. */
export default function ServerIndexPage() {
  const params = useParams<{ serverId: string }>();
  const serverId = params?.serverId ?? '';
  const router = useRouter();
  const { data: serverData, isLoading, isError } = useServer(serverId);
  const { data: channelsData } = useChannels(serverId);

  useEffect(() => {
    if (!channelsData || !serverId) return;
    const all: ChannelDTO[] = [
      ...channelsData.uncategorized,
      ...channelsData.categories.flatMap((c) => c.channels),
    ];
    const text = all.filter((c) => c.type !== 'VOICE').sort((a, b) => a.position - b.position);
    const first = text[0] ?? all[0];
    if (first) router.replace(`/app/servers/${serverId}/channels/${first.id}`);
  }, [channelsData, serverId, router]);

  if (isLoading)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  if (isError || !serverData)
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        You don&apos;t have access to this server — or it no longer exists.
      </div>
    );
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Opening server…
    </div>
  );
}
