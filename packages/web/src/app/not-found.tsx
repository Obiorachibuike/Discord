import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Sparkles className="h-7 w-7" />
      </div>
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">This page drifted off into the ether.</p>
      <Link
        href="/"
        className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
      >
        Back to Aether
      </Link>
    </div>
  );
}
