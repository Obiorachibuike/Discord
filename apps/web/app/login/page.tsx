import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { AuthForm } from '@/components/auth-form';
export const metadata: Metadata = { title: 'Sign in' };
export default function Login() { return <AuthShell eyebrow="Welcome back" title="Pick up where you left off." description="Your people and conversations are right where you left them."><Suspense><AuthForm mode="login"/></Suspense></AuthShell>; }
