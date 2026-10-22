import { cn } from '@/lib/utils';
export function BrandMark({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-grid shrink-0 place-items-center rounded-2xl bg-accent text-[#161322] shadow-[0_5px_22px_hsl(var(--accent)/.18)]', className)}>
    <svg viewBox="0 0 64 64" fill="none" className="h-[60%] w-[60%]" aria-hidden><path d="M43.5 19.5a18.5 18.5 0 1 0 0 25" stroke="currentColor" strokeWidth="6" strokeLinecap="round"/><path d="M35 25c7 3 7 11 0 14" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><circle cx="46" cy="32" r="3" fill="currentColor"/></svg>
  </span>;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="inline-flex items-center gap-3"><BrandMark className="h-10 w-10 rounded-[13px]" />{!compact && <span className="font-display text-[21px] font-extrabold tracking-[-.07em]">cove<span className="text-accent">.</span></span>}</span>;
}
