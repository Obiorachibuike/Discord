'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Compass, MessagesSquare } from 'lucide-react';
import type { ServerDTO } from '@aether/shared';
import { cn, initials } from '@/lib/utils';
import { Tooltip } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button, Field, Input, Textarea } from '@/components/ui/input';
import { useCreateServer, useJoinInvite } from '@/lib/hooks';
import { useToast } from '@/components/ui/toast';

export function ServerRail({
  servers,
  activeServerId,
}: {
  servers: ServerDTO[];
  activeServerId?: string;
}) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [joinOpen, setJoinOpen] = React.useState(false);

  return (
    <nav
      aria-label="Servers"
      className="flex h-full w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto border-r bg-[hsl(var(--background))] py-3 scroll-thin"
    >
      <Tooltip label="Direct messages">
        <Link
          href="/app/friends"
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-2xl bg-muted transition-all hover:rounded-xl hover:bg-accent hover:text-accent-foreground',
            !activeServerId && 'rounded-xl bg-accent text-accent-foreground',
          )}
        >
          <MessagesSquare className="h-5 w-5" />
        </Link>
      </Tooltip>
      <div className="my-1 h-px w-8 bg-border" />
      {servers.map((s) => (
        <Tooltip key={s.id} label={s.name}>
          <Link
            href={`/app/servers/${s.id}`}
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-sm font-semibold transition-all hover:rounded-xl hover:bg-accent hover:text-accent-foreground',
              activeServerId === s.id && 'rounded-xl bg-accent text-accent-foreground',
            )}
          >
            {s.iconUrl ? (
              <img src={s.iconUrl} alt="" className="h-full w-full rounded-2xl object-cover" />
            ) : (
              initials(s.name)
            )}
          </Link>
        </Tooltip>
      ))}
      <Tooltip label="Create a server">
        <button
          onClick={() => setCreateOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-success transition-all hover:rounded-xl hover:bg-success hover:text-white"
          aria-label="Create a server"
        >
          <Plus className="h-5 w-5" />
        </button>
      </Tooltip>
      <Tooltip label="Join with an invite">
        <button
          onClick={() => setJoinOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-success transition-all hover:rounded-xl hover:bg-success hover:text-white"
          aria-label="Join a server"
        >
          <Compass className="h-5 w-5" />
        </button>
      </Tooltip>
      <CreateServerDialog open={createOpen} onOpenChange={setCreateOpen} />
      <JoinServerDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </nav>
  );
}

function CreateServerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const create = useCreateServer();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create a server" description="Servers are communities with channels, roles and voice chat.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const { server } = await create.mutateAsync({ name, description: description || undefined });
              onOpenChange(false);
              setName('');
              setDescription('');
              toast({ kind: 'success', title: 'Server created' });
              router.push(`/app/servers/${server.id}`);
            } catch (err) {
              toast({ kind: 'error', title: 'Could not create server', description: (err as Error).message });
            }
          }}
        >
          <Field label="Server name" htmlFor="server-name">
            <Input
              id="server-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My community"
              minLength={2}
              maxLength={64}
              required
            />
          </Field>
          <Field label="Description (optional)" htmlFor="server-desc">
            <Textarea
              id="server-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={512}
              rows={3}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending || name.trim().length < 2}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function JoinServerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const join = useJoinInvite();
  const [code, setCode] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Join a server" description="Paste an invite link or code to join a community.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const clean = code.trim().split('/').pop() ?? '';
            try {
              const { serverId } = await join.mutateAsync(clean);
              onOpenChange(false);
              setCode('');
              toast({ kind: 'success', title: 'Joined server' });
              router.push(`/app/servers/${serverId}`);
            } catch (err) {
              toast({ kind: 'error', title: 'Invalid invite', description: (err as Error).message });
            }
          }}
        >
          <Field label="Invite link or code" htmlFor="invite-code">
            <Input
              id="invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="aBcDeF123 or https://…/invite/aBcDeF123"
              required
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={join.isPending || !code.trim()}>
              Join
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
