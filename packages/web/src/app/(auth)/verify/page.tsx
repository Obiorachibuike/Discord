'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/input';
import { apiPost, ApiError } from '@/lib/api';
import { Suspense } from 'react';

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = React.useState<'pending' | 'ok' | 'fail'>('pending');
  const [message, setMessage] = React.useState('Verifying your email…');

  React.useEffect(() => {
    if (!token) {
      setState('fail');
      setMessage('This verification link is missing its token.');
      return;
    }
    void (async () => {
      try {
        await apiPost('/api/auth/verify', { token });
        setState('ok');
        setMessage('Your email has been verified. You can close this page or continue to the app.');
      } catch (err) {
        setState('fail');
        setMessage(err instanceof ApiError ? err.message : 'Verification failed.');
      }
    })();
  }, [token]);

  return (
    <div className="text-center">
      {state === 'pending' ? <Loader2 className="mx-auto h-10 w-10 animate-spin text-accent" /> : null}
      {state === 'ok' ? <CheckCircle2 className="mx-auto h-10 w-10 text-success" /> : null}
      {state === 'fail' ? <XCircle className="mx-auto h-10 w-10 text-danger" /> : null}
      <h1 className="mt-4 text-2xl font-bold">Email verification</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <div className="mt-6 flex justify-center gap-2">
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
        {state === 'ok' ? (
          <Button asChild>
            <Link href="/app">Open Aether</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="text-center text-sm text-muted-foreground">Loading…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
