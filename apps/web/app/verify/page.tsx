import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { VerifyContent } from '@/components/token-pages';
export default function VerifyPage() { return <AuthShell eyebrow="One last step" title="Check your inbox." description="Let's make sure it's really you."><Suspense><VerifyContent/></Suspense></AuthShell>; }
