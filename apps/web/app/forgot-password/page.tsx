import { AuthShell } from '@/components/auth-shell';
import { ForgotContent } from '@/components/token-pages';
export default function ForgotPage() { return <AuthShell eyebrow="We've got you" title="Reset your password." description="Enter your email address and we'll send you a way back in."><ForgotContent/></AuthShell>; }
