import type { User } from '@cove/db';
export function publicUser(user: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'bio' | 'statusMessage' | 'presence' | 'createdAt'>) {
  return { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl,
    bio: user.bio, statusMessage: user.statusMessage, presence: 'OFFLINE' as const, createdAt: user.createdAt };
}
export function selfUser(user: User) {
  return { ...publicUser(user), email: user.email, emailVerifiedAt: user.emailVerifiedAt,
    presence: user.presence, allowDMFromMembers: user.allowDMFromMembers, notifyDMs: user.notifyDMs,
    notifyMentions: user.notifyMentions, notifyFriends: user.notifyFriends, theme: user.theme, accent: user.accent,
    updatedAt: user.updatedAt };
}
