import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: {
    default: 'Aether — communities in sync',
    template: '%s · Aether',
  },
  description:
    'Aether is a modern communication platform for communities: real-time text, voice, video, screen sharing and direct messages.',
  applicationName: 'Aether',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#101218' },
    { media: '(prefers-color-scheme: light)', color: '#f5f6fa' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
