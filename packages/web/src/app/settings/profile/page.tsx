'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/lib/auth';
import { useUpdateProfile, useUploadAvatar } from '@/lib/hooks';
import { useToast } from '@/components/ui/toast';
import { Button, Field, Input, Textarea } from '@/components/ui/input';
import { Avatar } from '@/components/ui/primitives';

const profileFormSchema = z.object({
  displayName: z.string().min(2).max(80),
  customStatus: z.string().max(160).optional().or(z.literal('')),
  bio: z.string().max(280).optional().or(z.literal('')),
});
type ProfileForm = z.infer<typeof profileFormSchema>;

export default function ProfileSettingsPage() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const update = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileFormSchema),
    values: {
      displayName: user?.displayName ?? '',
      customStatus: user?.customStatus ?? '',
      bio: user?.bio ?? '',
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">How you appear to everyone on Aether.</p>

      <div className="mt-8 rounded-lg border p-6">
        <h2 className="font-semibold">Avatar</h2>
        <div className="mt-4 flex items-center gap-6">
          <Avatar name={user?.displayName ?? ''} src={user?.avatarUrl} size="lg" />
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const form = new FormData();
                form.append('file', f);
                uploadAvatar.mutate(form, {
                  onSuccess: async () => {
                    await refresh();
                    toast({ kind: 'success', title: 'Avatar updated' });
                  },
                  onError: (err) =>
                    toast({
                      kind: 'error',
                      title: 'Upload failed',
                      description: err instanceof Error ? err.message : undefined,
                    }),
                });
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploadAvatar.isPending}
            >
              {uploadAvatar.isPending ? 'Uploading…' : 'Upload image'}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              PNG, JPEG, GIF or WebP up to 8 MB. Stored on the configured file storage.
            </p>
          </div>
        </div>
      </div>

      <form
        className="mt-6 space-y-4 rounded-lg border p-6"
        onSubmit={handleSubmit(async (data) => {
          try {
            await update.mutateAsync({
              displayName: data.displayName,
              customStatus: data.customStatus || null,
              bio: data.bio || null,
            });
            await refresh();
            toast({ kind: 'success', title: 'Profile saved' });
          } catch (err) {
            toast({
              kind: 'error',
              title: 'Could not save',
              description: err instanceof Error ? err.message : undefined,
            });
          }
        })}
      >
        <h2 className="font-semibold">About you</h2>
        <Field label="Display name" htmlFor="displayName" error={errors.displayName?.message}>
          <Input id="displayName" {...register('displayName')} />
        </Field>
        <Field
          label="Custom status"
          htmlFor="customStatus"
          error={errors.customStatus?.message}
          hint="A short line shown on your profile."
        >
          <Input id="customStatus" placeholder="What are you up to?" {...register('customStatus')} />
        </Field>
        <Field label="Bio" htmlFor="bio" error={errors.bio?.message}>
          <Textarea id="bio" rows={3} placeholder="Tell the community about yourself." {...register('bio')} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
