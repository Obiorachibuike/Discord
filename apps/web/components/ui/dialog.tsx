'use client';
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
export const DialogRoot = Dialog.Root;
export const DialogTrigger = Dialog.Trigger;
export const DialogClose = Dialog.Close;
export function DialogContent({ children, className, title, description }: { children: React.ReactNode; className?: string; title: string; description?: string }) {
  return <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-[#070811]/75 backdrop-blur-[5px] data-[state=open]:animate-fade-in" />
    <Dialog.Content className={cn('fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-line bg-panel p-6 shadow-float data-[state=open]:animate-fade-in', className)}>
      <div className="mb-5 flex items-start justify-between gap-3"><div><Dialog.Title className="font-display text-xl font-bold tracking-tight">{title}</Dialog.Title>{description && <Dialog.Description className="mt-1 text-sm leading-6 text-subtle">{description}</Dialog.Description>}</div>
      <Dialog.Close aria-label="Close dialog" className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-muted hover:text-ink"><X size={18}/></Dialog.Close></div>{children}
    </Dialog.Content></Dialog.Portal>;
}
export function ConfirmDialog({ open, onOpenChange, title, description, onConfirm, destructive = true, requiredText }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; onConfirm: () => void; destructive?: boolean; requiredText?: string;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  return <DialogRoot open={open} onOpenChange={onOpenChange}><DialogContent title={title} description={description}>
    {requiredText && <div className="mb-5"><label htmlFor="delete-confirmation" className="mb-2 block text-xs font-semibold">Type <strong>{requiredText}</strong> to confirm</label><input id="delete-confirmation" autoComplete="off" className="field" value={typed} onChange={e => setTyped(e.target.value)}/></div>}
    <div className="flex justify-end gap-2"><button onClick={() => onOpenChange(false)} className="rounded-xl px-4 py-2 text-sm text-subtle hover:bg-muted hover:text-ink">Cancel</button><button disabled={!!requiredText && typed !== requiredText} className={cn('rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40', destructive ? 'bg-rose-500 text-white' : 'bg-accent text-[#171321]')} onClick={onConfirm}>Confirm</button></div>
  </DialogContent></DialogRoot>;
}
