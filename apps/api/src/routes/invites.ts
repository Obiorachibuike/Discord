import { Router } from 'express';
import { db } from '@cove/db';
import { hash } from '../lib/crypto';
import { HttpError, route } from '../lib/errors';
import { membershipChanged } from '../services/servers';
import { notify } from '../services/notifications';
import { invitationUsable } from '../services/invitations';
const router = Router();
function tokenValue(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new HttpError(404, 'NOT_FOUND', 'Invite not found.');
  return hash(value);
}
async function getInvite(token: string) {
  const invite = await db.invitation.findUnique({ where: { tokenHash: tokenValue(token) }, include: { server: { select: { id: true, name: true, description: true, iconUrl: true, _count: { select: { members: true } } } } } });
  if (!invite || !invitationUsable(invite))
    throw new HttpError(404, 'INVITE_EXPIRED', 'This invite has expired or been revoked.');
  return invite;
}
router.get('/:token', route(async (req, res) => {
  const invite = await getInvite(req.params.token!);
  res.json({ invite: { server: invite.server, expiresAt: invite.expiresAt, remainingUses: invite.maxUses === null ? null : invite.maxUses - invite.uses } });
}));
router.post('/:token/accept', route(async (req, res) => {
  const invite = await getInvite(req.params.token!);
  const userId = req.auth!.userId;
  const ban = await db.serverBan.findUnique({ where: { serverId_userId: { serverId: invite.serverId, userId } } });
  if (ban) throw new HttpError(403, 'BANNED', 'You cannot join this community.');
  const existing = await db.serverMember.findUnique({ where: { serverId_userId: { serverId: invite.serverId, userId } } });
  if (existing) return res.json({ serverId: invite.serverId, alreadyMember: true });
  await db.$transaction(async tx => {
    // Conditional update locks the invite row. Two last-use accepts cannot both win.
    const consumed = await tx.invitation.updateMany({ where: {
      id: invite.id, revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      ...(invite.maxUses === null ? {} : { uses: { lt: invite.maxUses } })
    }, data: { uses: { increment: 1 } } });
    if (!consumed.count) throw new HttpError(409, 'INVITE_EXPIRED', 'This invite has expired or been revoked.');
    const member = await tx.serverMember.create({ data: { serverId: invite.serverId, userId } });
    const defaultRole = await tx.role.findFirst({ where: { serverId: invite.serverId, isDefault: true } });
    if (defaultRole) await tx.memberRole.create({ data: { memberId: member.id, roleId: defaultRole.id } });
    await tx.auditLog.create({ data: { serverId: invite.serverId, actorId: userId, action: 'MEMBER_JOINED', targetType: 'user', targetId: userId } });
  });
  membershipChanged(invite.serverId, userId);
  await notify(invite.issuerId, 'INVITE', { serverId: invite.serverId, userId }, userId, `invite:${invite.id}:${userId}`);
  res.status(201).json({ serverId: invite.serverId, alreadyMember: false });
}));
export default router;
