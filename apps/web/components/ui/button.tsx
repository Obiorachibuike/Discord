import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary'|'secondary'|'ghost'|'danger'|'outline'; size?: 'sm'|'md'|'lg'|'icon' };
export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ className, variant = 'primary', size = 'md', ...props }, ref) {
  return <button ref={ref} className={cn('inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent',
    { primary: 'bg-accent text-[#171321] hover:brightness-110 active:scale-[.98]', secondary: 'bg-elevated text-ink hover:bg-muted', ghost: 'text-subtle hover:bg-muted hover:text-ink', danger: 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25', outline: 'border border-line text-ink hover:bg-muted' }[variant],
    { sm: 'h-9 px-3 text-xs', md: 'h-11 px-4 text-sm', lg: 'h-12 px-6 text-sm', icon: 'h-9 w-9 p-0' }[size], className)} {...props} />;
});
