'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema } from '@aether/shared';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { apiPost } from '@/lib/api';

type ForgotInput = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [sent, setSent] = React.useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotInput>({ resolver: zodResolver(forgotPasswordSchema) });

  return (
    <div>
      <h1 className="text-2xl font-bold">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your account email and we&apos;ll send a reset link if an account exists.
      </p>
      {sent ? (
        <div className="mt-6 rounded-md border bg-accent-soft/40 p-4 text-sm">
          If that email is registered, a reset link is on its way. Check your inbox — the link
          expires in 1 hour.
        </div>
      ) : (
        <form
          onSubmit={handleSubmit(async (data) => {
            await apiPost('/api/auth/forgot', data);
            setSent(true);
            toast({ kind: 'success', title: 'Request received' });
          })}
          className="mt-6 space-y-4"
        >
          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
          </Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
