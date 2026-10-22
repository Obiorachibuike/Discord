'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@aether/shared';
import { Button, Field, Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { apiPost, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { refresh } = useAuth();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await apiPost('/api/auth/login', data);
      await refresh();
      router.replace('/app');
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Something went wrong — please try again.';
      toast({ kind: 'error', title: 'Sign in failed', description: message });
    }
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign in to your Aether account to continue.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Field label="Email or username" htmlFor="identifier" error={errors.emailOrUsername?.message}>
          <Input
            id="identifier"
            autoComplete="username"
            placeholder="you@example.com"
            {...register('emailOrUsername')}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            {...register('password')}
          />
        </Field>
        <div className="flex items-center justify-between text-sm">
          <Link href="/forgot" className="text-accent hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to Aether?{' '}
        <Link href="/register" className="text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
