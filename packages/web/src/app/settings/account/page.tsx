'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiPost, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button, Field, Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { useUpdateAccount, useDeleteAccount } from '@/lib/hooks';

const accountFormSchema = z.object({
  username: z.string().min(3).max(32).optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(10).max(256).optional(),
});
type AccountForm = z.infer<typeof accountFormSchema>;

export default function AccountSettingsPage() {
  const { user, refresh, logout } = useAuth();
  const { toast } = useToast();
  const updateAccount = useUpdateAccount();
  const deleteAccount = useDeleteAccount();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AccountForm>({
    resolver: zodResolver(accountFormSchema),
    values: { username: user?.username ?? '' },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Account & Security</h1>
      <p className="mt-1 text-sm text-muted-foreground">Manage your credentials and account safety.</p>

      <div className="mt-8 space-y-4 rounded-lg border p-6">
        <h2 className="font-semibold">Email</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">{user?.email}</p>
            <p className="text-xs text-muted-foreground">
              {user?.emailVerified
                ? 'Verified'
                : 'Not verified — check your inbox for the link.'}
            </p>
          </div>
          {!user?.emailVerified ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await apiPost('/api/auth/resend-verification', {});
                  toast({ kind: 'success', title: 'Verification email sent' });
                } catch (err) {
                  toast({
                    kind: 'error',
                    title: 'Could not send email',
                    description: err instanceof ApiError ? err.message : undefined,
                  });
                }
              }}
            >
              Resend verification
            </Button>
          ) : null}
        </div>
      </div>

      <form
        className="mt-6 space-y-4 rounded-lg border p-6"
        onSubmit={handleSubmit(async (data) => {
          try {
            await updateAccount.mutateAsync({
              username: data.username || undefined,
              currentPassword: data.currentPassword || undefined,
              newPassword: data.newPassword || undefined,
            });
            await refresh();
            toast({ kind: 'success', title: 'Account updated' });
            reset({ username: data.username, currentPassword: '', newPassword: '' });
          } catch (err) {
            toast({
              kind: 'error',
              title: 'Update failed',
              description: err instanceof ApiError ? err.message : undefined,
            });
          }
        })}
      >
        <h2 className="font-semibold">Username & password</h2>
        <Field label="Username" htmlFor="username" error={errors.username?.message}>
          <Input id="username" autoComplete="username" {...register('username')} />
        </Field>
        <Field
          label="Current password"
          htmlFor="currentPassword"
          error={errors.currentPassword?.message}
          hint="Required only when changing your password."
        >
          <Input id="currentPassword" type="password" autoComplete="current-password" {...register('currentPassword')} />
        </Field>
        <Field
          label="New password"
          htmlFor="newPassword"
          error={errors.newPassword?.message}
          hint="At least 10 characters. Changing it signs out your other sessions."
        >
          <Input id="newPassword" type="password" autoComplete="new-password" {...register('newPassword')} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting || updateAccount.isPending}>
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-danger/30 bg-danger/5 p-6">
        <h2 className="font-semibold text-danger">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Deleting your account is permanent and signs you out everywhere. Your past messages remain
          unless a server owner removes them.
        </p>
        <Button
          variant="destructive"
          className="mt-4"
          disabled={deleteAccount.isPending}
          onClick={async () => {
            if (!confirm('Delete your account permanently? This cannot be undone.')) return;
            try {
              await deleteAccount.mutateAsync();
              toast({ kind: 'success', title: 'Account deleted' });
              await logout();
            } catch (err) {
              toast({
                kind: 'error',
                title: 'Could not delete account',
                description: err instanceof ApiError ? err.message : undefined,
              });
            }
          }}
        >
          Delete account
        </Button>
      </div>
    </div>
  );
}
