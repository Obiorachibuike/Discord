'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@aether/shared';
import { Button, Field, Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { apiPost, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { refresh } = useAuth();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', username: '', password: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await apiPost('/api/auth/register', data);
      await refresh();
      toast({
        kind: 'success',
        title: 'Welcome to Aether!',
        description: 'Check your email to verify your account.',
      });
      router.replace('/app');
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Something went wrong — please try again.';
      toast({ kind: 'error', title: 'Registration failed', description: message });
    }
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Join communities, chat in real time and hop into voice rooms.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" {...register('email')} />
        </Field>
        <Field
          label="Username"
          htmlFor="username"
          error={errors.username?.message}
          hint="Letters, numbers, dots, dashes and underscores."
        >
          <Input id="username" autoComplete="username" placeholder="cosmic_fox" {...register('username')} />
        </Field>
        <Field label="Display name (optional)" htmlFor="displayName" error={errors.displayName?.message}>
          <Input id="displayName" placeholder="Cosmic Fox" {...register('displayName')} />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
          hint="At least 10 characters."
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••••"
            {...register('password')}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
