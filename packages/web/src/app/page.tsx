'use client';

import Link from 'next/link';
import {
  MessagesSquare,
  Mic,
  Video,
  Shield,
  Users,
  Sparkles,
  ArrowRight,
  MonitorUp,
} from 'lucide-react';
import { Button } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const features = [
  {
    icon: MessagesSquare,
    title: 'Real-time text channels',
    description:
      'Organized channels with replies, reactions, pins, file attachments and full-text search — all live over WebSockets.',
  },
  {
    icon: Mic,
    title: 'Crystal-clear voice',
    description:
      'Drop into voice channels with one click. Mute, deafen, and see who is speaking in real time.',
  },
  {
    icon: Video,
    title: 'Video & screen sharing',
    description:
      'Camera tiles, active-speaker indicators and one-click screen sharing powered by WebRTC.',
  },
  {
    icon: Users,
    title: 'Friends & direct messages',
    description:
      'Friend requests, group conversations, typing indicators and presence — your private space.',
  },
  {
    icon: Shield,
    title: 'Roles & moderation',
    description:
      'Granular permissions, private channels, audit logs, timeouts, kicks and bans keep communities safe.',
  },
  {
    icon: MonitorUp,
    title: 'Files that just work',
    description:
      'Drag-and-drop images, documents and video with previews, progress and secure access control.',
  },
];

export default function LandingPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user) router.replace('/app');
  }, [user, isLoading, router]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold tracking-tight">Aether</span>
        </div>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/register">Get started</Link>
          </Button>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border bg-surface px-3 py-1 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-success" />
          Open-source community platform — self-hostable
        </div>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Where your community{' '}
          <span className="bg-gradient-to-r from-accent to-[hsl(280_80%_62%)] bg-clip-text text-transparent">
            comes together
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Aether brings text channels, voice rooms, video calls, screen sharing and direct messages
          into one fast, polished platform you can actually run yourself.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/register">
              Create your account <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>

        {/* App preview mock */}
        <div className="relative mx-auto mt-16 max-w-4xl">
          <div className="overflow-hidden rounded-2xl border bg-surface shadow-2xl">
            <div className="flex h-10 items-center gap-1.5 border-b bg-surface-raised px-4">
              <span className="h-3 w-3 rounded-full bg-danger/70" />
              <span className="h-3 w-3 rounded-full bg-warning/70" />
              <span className="h-3 w-3 rounded-full bg-success/70" />
              <span className="ml-3 text-xs text-muted-foreground">aether — #general</span>
            </div>
            <div className="flex h-72 text-left">
              <div className="w-14 space-y-2 border-r bg-[hsl(var(--background))] p-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-9 w-9 rounded-xl bg-muted" />
                ))}
              </div>
              <div className="w-40 space-y-2 border-r bg-surface p-3">
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="h-4 w-20 rounded bg-accent-soft" />
                <div className="h-4 w-28 rounded bg-muted" />
                <div className="h-4 w-16 rounded bg-muted" />
              </div>
              <div className="flex-1 space-y-3 p-4">
                <div className="flex gap-2">
                  <div className="h-8 w-8 rounded-full bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-24 rounded bg-muted" />
                    <div className="h-3 w-3/4 rounded bg-muted/70" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="h-8 w-8 rounded-full bg-accent-soft" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-20 rounded bg-muted" />
                    <div className="h-3 w-2/3 rounded bg-muted/70" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="h-8 w-8 rounded-full bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-28 rounded bg-muted" />
                    <div className="h-3 w-1/2 rounded bg-muted/70" />
                  </div>
                </div>
                <div className="mt-6 h-9 rounded-md border bg-surface-raised" />
              </div>
              <div className="hidden w-36 space-y-2 border-l bg-surface p-3 md:block">
                <div className="h-4 w-16 rounded bg-muted" />
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-muted" />
                    <div className="h-3 w-16 rounded bg-muted/70" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="absolute -bottom-6 -right-6 hidden rounded-xl border bg-surface-raised p-4 shadow-xl sm:block">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success/15 text-success">
                <Mic className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-semibold">Voice connected</p>
                <p className="text-[10px] text-muted-foreground">4 people in #hangout</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="text-center text-3xl font-bold tracking-tight">
          Everything a community needs
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
          Built as a real product — authentication, permissions, moderation, notifications and
          deployment tooling included.
        </p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="panel p-6 transition-shadow hover:shadow-md">
              <div className="mb-4 inline-flex rounded-lg bg-accent-soft p-2.5 text-accent">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Ready to build your community?</h2>
          <p className="max-w-xl text-muted-foreground">
            Create an account in seconds. Self-host with Docker or Node.js — your data stays yours.
          </p>
          <Button size="lg" asChild>
            <Link href="/register">
              Get started free <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <span>Aether — an original open platform. Not affiliated with Discord.</span>
          </div>
          <div className="flex gap-4">
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
            <Link href="/register" className="hover:text-foreground">
              Register
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
