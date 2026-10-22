import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { AuthForm } from '@/components/auth-form';
export const metadata: Metadata = { title: 'Join Cove' };
export default function Register() { return <AuthShell eyebrow="Come on in" title="Make yourself at home." description="A place to share, connect and belong. Your story starts here."><Suspense><AuthForm mode="register"/></Suspense></AuthShell>; }
