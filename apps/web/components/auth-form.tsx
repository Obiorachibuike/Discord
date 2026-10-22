'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, loginSchema } from '@cove/shared';
import type { z } from 'zod';
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { api, ApiError, json } from '@/lib/api';
import { Button } from './ui/button';
function nextPath(value: string | null) { return value?.startsWith('/') && !value.startsWith('//') ? value : '/app'; }
export function AuthForm({ mode }: { mode: 'login'|'register' }) {
  const router = useRouter(); const search = useSearchParams();
  const providers = useQuery({ queryKey: ['auth-providers'], queryFn: () => api<{ google: boolean }>('/auth/providers'), retry: false });
  const [error, setError] = useState(''); const [visible, setVisible] = useState(false); const [pending, setPending] = useState(false);
  const schema = mode === 'register' ? registerSchema : loginSchema;
  const form = useForm<z.infer<typeof registerSchema>>({ resolver: zodResolver(schema) as never, defaultValues: { email: '', username: '', displayName: '', password: '' } });
  async function submit(values: z.infer<typeof registerSchema>) {
    setError(''); setPending(true);
    try {
      const response = await api<{ user?: unknown; message?: string }>(`/auth/${mode}`, { method: 'POST', body: json(mode === 'login' ? { email: values.email, password: values.password } : values) });
      if (response.user) { router.push(nextPath(search.get('next'))); router.refresh(); }
      else router.push(`/verify?email=${encodeURIComponent(values.email)}`);
    } catch (cause) {
      const message = cause instanceof ApiError && cause.code === 'EMAIL_UNVERIFIED' ? 'Please verify your email first. Check your inbox or request a new link.' : cause instanceof Error ? cause.message : 'Please try again.';
      setError(message);
    } finally { setPending(false); }
  }
  return <><form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
    {mode === 'register' && <><div><label htmlFor="displayName" className="mb-2 block text-xs font-semibold text-ink">Display name</label><input id="displayName" autoComplete="name" className="field" placeholder="What should we call you?" {...form.register('displayName')}/><FieldError text={form.formState.errors.displayName?.message}/></div><div><label htmlFor="username" className="mb-2 block text-xs font-semibold text-ink">Username</label><input id="username" autoComplete="username" className="field" placeholder="your_username" {...form.register('username')}/><FieldError text={form.formState.errors.username?.message}/></div></>}
    <div><label htmlFor="email" className="mb-2 block text-xs font-semibold text-ink">Email address</label><input id="email" type="email" autoComplete="email" className="field" placeholder="you@example.com" {...form.register('email')}/><FieldError text={form.formState.errors.email?.message}/></div>
    <div><div className="mb-2 flex items-center justify-between"><label htmlFor="password" className="text-xs font-semibold text-ink">Password</label>{mode === 'login' && <Link href="/forgot-password" className="text-xs font-semibold text-accent hover:underline">Forgot password?</Link>}</div><div className="relative"><input id="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className="field pr-12" placeholder={mode === 'register' ? 'At least 12 characters' : 'Enter your password'} {...form.register('password')}/><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-subtle hover:text-ink">{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><FieldError text={form.formState.errors.password?.message}/></div>
    {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-400">{error}</div>}
    <Button type="submit" className="mt-2 w-full" disabled={pending}>{pending ? <LoaderCircle size={17} className="animate-spin"/> : <ArrowRight size={17}/>} {mode === 'login' ? 'Sign in' : 'Create your account'}</Button>
  </form><p className="mt-6 text-center text-sm text-subtle">{mode === 'login' ? 'New around here?' : 'Already have an account?'} <Link className="font-semibold text-accent hover:underline" href={`${mode === 'login' ? '/register' : '/login'}${search.get('next') ? `?next=${encodeURIComponent(nextPath(search.get('next')))}` : ''}`}>{mode === 'login' ? 'Create an account' : 'Sign in'}</Link></p>
    {providers.data?.google && <><div className="my-6 flex items-center gap-3 text-xs text-subtle/70"><span className="h-px flex-1 bg-line"/> or continue with <span className="h-px flex-1 bg-line"/></div>
    <a href="/api/auth/google" className="flex h-11 items-center justify-center gap-3 rounded-xl border border-line bg-elevated text-sm font-semibold transition-colors hover:bg-muted"><svg viewBox="0 0 48 48" aria-hidden className="h-4 w-4"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.6-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38 46.98 31.8 46.98 24.55z"/><path fill="#FBBC05" d="M10.53 28.7A14.4 14.4 0 0 1 9.75 24c0-1.63.28-3.2.77-4.7l-7.9-6.1A23.87 23.87 0 0 0 0 24c0 3.86.93 7.51 2.62 10.8l7.91-6.1z"/><path fill="#34A853" d="M24 48c6.48 0 11.94-2.14 15.91-5.8l-7.73-6c-2.14 1.44-4.87 2.3-8.18 2.3-6.24 0-11.62-4.1-13.47-9.8l-7.91 6.1C6.51 42.6 14.58 48 24 48z"/></svg> Continue with Google</a></>}
  </>;
}
function FieldError({ text }: { text?: string }) { return text ? <p className="mt-1 text-xs text-rose-400" role="alert">{text}</p> : null; }
