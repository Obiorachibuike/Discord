'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Users, Loader2 } from 'lucide-react';
import { Button, Spinner } from '@/components/ui/input';
import { Avatar } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface InvitePreview {
  code: string;
  serverName: string;
  serverIconUrl: string | null;
  inviterName: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
}

export default function InvitePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [invite, setInvite] = React.useState<InvitePreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [joining, setJoining] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await apiGet<{ invite: InvitePreview }>(`/api/invites/${params.code}`);
        setInvite(res.invite);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'This invite is invalid or has expired.');
      }
    })();
  }, [params.code]);

  const join = async () => {
    if (!user) {
      router.push(`/register?next=/invite/${params.code}`);
      return;
    }
    setJoining(true);
    try {
      const res = await apiPost<{ serverId: string; alreadyMember: boolean }>(
        `/api/invites/${params.code}/join`,
      );
      toast({
        kind: 'success',
        title: res.alreadyMember ? 'You are already a member' : 'Welcome!',
      });
      router.push(`/app/servers/${res.serverId}`);
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not join',
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="text-center">
      {error ? (
        <>
          <Users className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 text-2xl font-bold">Invite invalid</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button asChild className="mt-6" variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        </>
      ) : !invite ? (
        <div className="flex flex-col items-center gap-3">
          <Spinner className="h-8 w-8" />
          <p className="text-sm text-muted-foreground">Loading invite…</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{invite.inviterName} invited you to join</p>
          <div className="mt-4 flex flex-col items-center gap-3">
            <Avatar name={invite.serverName} src={invite.serverIconUrl} size="lg" />
            <h1 className="text-2xl font-bold">{invite.serverName}</h1>
            <p className="text-xs text-muted-foreground">
              {invite.uses} member(s) have joined with this invite
            </p>
          </div>
          <Button className="mt-6 w-full" onClick={() => void join()} disabled={joining || authLoading}>
            {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {user ? 'Accept invite' : 'Create an account to join'}
          </Button>
          {user ? null : (
            <p className="mt-4 text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href={`/login?next=/invite/${params.code}`} className="text-accent hover:underline">
                Sign in
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
