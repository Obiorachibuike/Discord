'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema } from '@aether/shared';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { apiPost, ApiError } from '@/lib/api';
import { Suspense } from 'react';

type ResetInput = z.infer<typeof resetPasswordSchema>;

function ResetInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '' },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your old sessions will be signed out everywhere.
      </p>
      {!token ? (
        <div className="mt-6 rounded-md border bg-danger/10 p-4 text-sm">
          This reset link is missing its token.{' '}
          <Link href="/forgot" className="text-accent underline">
            Request a new one
          </Link>
          .
        </div>
      ) : (
        <form
          onSubmit={handleSubmit(async (data) => {
            try {
              await apiPost('/api/auth/reset', { ...data, token });
              toast({ kind: 'success', title: 'Password updated', description: 'Sign in with your new password.' });
              router.replace('/login');
            } catch (err) {
              toast({
                kind: 'error',
                title: 'Reset failed',
                description: err instanceof ApiError ? err.message : 'Try again.',
              });
            }
          })}
          className="mt-6 space-y-4"
        >
          <Field label="New password" htmlFor="password" error={errors.password?.message} hint="At least 10 characters.">
            <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
          </Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="text-center text-sm text-muted-foreground">Loading…</div>}>
      <ResetInner />
    </Suspense>
  );
}
