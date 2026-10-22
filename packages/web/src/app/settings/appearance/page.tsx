'use client';

import * as React from 'react';
import { useTheme, ACCENT_PRESETS, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/primitives';
import { Check, Moon, Sun } from 'lucide-react';

export default function AppearanceSettingsPage() {
  const { mode, setMode, accent, setAccent } = useTheme();

  return (
    <div>
      <h1 className="text-2xl font-bold">Appearance</h1>
      <p className="mt-1 text-sm text-muted-foreground">Make Aether yours.</p>

      <div className="mt-8 space-y-4 rounded-lg border p-6">
        <h2 className="font-semibold">Theme</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Dark mode</p>
            <p className="text-xs text-muted-foreground">Easier on the eyes at night.</p>
          </div>
          <Switch
            checked={mode === 'dark'}
            onCheckedChange={(v) => setMode(v ? 'dark' : 'light')}
            aria-label="Toggle dark mode"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { id: 'dark' as ThemeMode, label: 'Midnight', icon: Moon },
              { id: 'light' as ThemeMode, label: 'Daylight', icon: Sun },
            ]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setMode(t.id)}
              className={cn(
                'flex items-center gap-2 rounded-md border p-4 text-left text-sm transition-colors',
                mode === t.id ? 'border-accent bg-accent-soft' : 'hover:border-accent/50',
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg border p-6">
        <h2 className="font-semibold">Accent color</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Used for highlights and interactive elements.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => setAccent(preset.value)}
              title={preset.name}
              aria-label={`Accent: ${preset.name}`}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:scale-110',
                accent === preset.value && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
              )}
              style={{ background: `hsl(${preset.value})` }}
            >
              {accent === preset.value ? <Check className="h-4 w-4 text-white" /> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg border p-6">
        <h2 className="font-semibold">Preview</h2>
        <div className="mt-3 rounded-md bg-muted/40 p-4">
          <p className="text-sm">
            This is how <span className="text-accent">accent text</span> and{' '}
            <button className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
              buttons
            </button>{' '}
            look in your theme.
          </p>
        </div>
      </div>
    </div>
  );
}
