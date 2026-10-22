export function invitationUsable(invite: { revokedAt: Date | null; expiresAt: Date | null; maxUses: number | null; uses: number }, now = new Date()) {
  return !invite.revokedAt && (!invite.expiresAt || invite.expiresAt > now) && (invite.maxUses === null || invite.uses < invite.maxUses);
}
