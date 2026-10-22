import { cn, initials, avatarColor } from '@/lib/utils';
export function Avatar({ name, src, className, status }: { name: string; src?: string | null; className?: string; status?: string }) {
  return <span className={cn('relative inline-grid h-10 w-10 shrink-0 place-items-center overflow-visible rounded-[13px] text-sm font-bold text-white', className)} style={{ backgroundColor: avatarColor(name) }}>
    {src ? <img src={src} alt="" className="h-full w-full rounded-[inherit] object-cover" /> : initials(name)}
    {status && <span className={cn('absolute -bottom-0.5 -right-0.5 h-[11px] w-[11px] rounded-full border-[2px] border-panel', {
      ONLINE: 'bg-emerald-400', IDLE: 'bg-amber-400', DND: 'bg-rose-400', OFFLINE: 'bg-subtle/70', INVISIBLE: 'bg-subtle/70'
    }[status] ?? 'bg-subtle/70')} aria-label={status.toLowerCase()} />}
  </span>;
}
