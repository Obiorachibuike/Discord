import type { Metadata } from 'next';
import { AppShell } from '@/components/app/shell';
export const metadata: Metadata = { title: 'Your space' };
export default function AppPage() { return <AppShell/>; }
