import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
export const metadata: Metadata = { title: { default: 'Cove — Your people, all in one place', template: '%s · Cove' },
  description: 'A calmer place to talk, share and make things happen together.', applicationName: 'Cove', icons: { icon: '/favicon.svg' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#12141d' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning><body><Providers>{children}</Providers></body></html>;
}
