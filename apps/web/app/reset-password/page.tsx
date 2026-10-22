import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { ResetContent } from '@/components/token-pages';
export default function ResetPage() { return <AuthShell eyebrow="Fresh start" title="Choose a new password." description="Make it a strong one you'll remember."><Suspense><ResetContent/></Suspense></AuthShell>; }
