import { Router } from 'express';
import {
  createInviteSchema,
  createRoleSchema,
  memberRoleAssignSchema,
  transferOwnershipSchema,
  updateRoleSchema,
  updateServerSchema,
  createServerSchema,
} from '@aether/shared';
import { z } from 'zod';
import { mustAuth, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { servers } from '../services/server.service.js';
import { permissions } from '../services/permission.service.js';
import { toMemberDTO, toRoleDTO, toServerDTO } from '../utils/dto.js';
import { ALL_PERMISSIONS } from '@aether/shared';

export const serversRouter = Router();
serversRouter.use(requireAuth);

serversRouter.get('/', async (req, res) => {
  const auth = mustAuth(req);
  const list = await servers.listForUser(auth.id);
  const items = [];
  for (const s of list) {
    const ctx = await permissions.getServerContext(s.id, auth.id);
    items.push(toServerDTO(s, ctx.isOwner ? ALL_PERMISSIONS : ctx.rolePermissions));
  }
  res.json({ servers: items });
});

serversRouter.post('/', validateBody(createServerSchema), async (req, res) => {
  const auth = mustAuth(req);
  const server = await servers.create(auth.id, req.body);
  res.status(201).json({ server: toServerDTO(server, ALL_PERMISSIONS) });
});

serversRouter.get('/:id', async (req, res) => {
  const auth = mustAuth(req);
  const { server, ctx } = await servers.getForUser(req.params.id!, auth.id);
  res.json({
    server: toServerDTO(server, ctx.isOwner ? ALL_PERMISSIONS : ctx.rolePermissions),
  });
});

serversRouter.patch('/:id', validateBody(updateServerSchema), async (req, res) => {
  const auth = mustAuth(req);
  const server = await servers.update(req.params.id!, auth.id, req.body);
  res.json({ server: toServerDTO(server, ALL_PERMISSIONS) });
});

serversRouter.delete('/:id', async (req, res) => {
  const auth = mustAuth(req);
  await servers.remove(req.params.id!, auth.id);
  res.json({ ok: true });
});

serversRouter.post('/:id/leave', async (req, res) => {
  const auth = mustAuth(req);
  await servers.leave(req.params.id!, auth.id);
  res.json({ ok: true });
});

serversRouter.post(
  '/:id/transfer',
  validateBody(transferOwnershipSchema),
  async (req, res) => {
    const auth = mustAuth(req);
    await servers.transferOwnership(req.params.id!, auth.id, req.body.userId);
    res.json({ ok: true });
  },
);

serversRouter.get('/:id/members', async (req, res) => {
  const auth = mustAuth(req);
  const q = z
    .object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() })
    .parse(req.query);
  const { items, nextCursor } = await servers.listMembers(req.params.id!, auth.id, {
    cursor: q.cursor,
    limit: q.limit ?? 50,
  });
  res.json({ members: items.map(toMemberDTO), nextCursor });
});

serversRouter.delete('/:id/members/:userId', async (req, res) => {
  const auth = mustAuth(req);
  await servers.kick(req.params.id!, auth.id, req.params.userId!, String(req.query.reason ?? ''));
  res.json({ ok: true });
});

// ── Invites ──────────────────────────────────────────────────────────────────

serversRouter.post('/:id/invites', validateBody(createInviteSchema), async (req, res) => {
  const auth = mustAuth(req);
  const invite = await servers.createInvite(req.params.id!, auth.id, req.body);
  res.status(201).json({
    invite: {
      code: invite.code,
      url: `/invite/${invite.code}`,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      maxUses: invite.maxUses,
      uses: invite.uses,
    },
  });
});

serversRouter.get('/:id/invites', async (req, res) => {
  const auth = mustAuth(req);
  const invites = await servers.listInvites(req.params.id!, auth.id);
  res.json({
    invites: invites.map((i) => ({
      code: i.code,
      url: `/invite/${i.code}`,
      expiresAt: i.expiresAt?.toISOString() ?? null,
      maxUses: i.maxUses,
      uses: i.uses,
    })),
  });
});

// ── Roles ────────────────────────────────────────────────────────────────────

serversRouter.get('/:id/roles', async (req, res) => {
  const auth = mustAuth(req);
  const roles = await servers.listRoles(req.params.id!, auth.id);
  res.json({ roles: roles.map(toRoleDTO) });
});

serversRouter.post('/:id/roles', validateBody(createRoleSchema), async (req, res) => {
  const auth = mustAuth(req);
  const role = await servers.createRole(req.params.id!, auth.id, req.body);
  res.status(201).json({ role });
});

serversRouter.patch('/:id/roles/:roleId', validateBody(updateRoleSchema), async (req, res) => {
  const auth = mustAuth(req);
  const role = await servers.updateRole(req.params.id!, req.params.roleId!, auth.id, req.body);
  res.json({ role });
});

serversRouter.delete('/:id/roles/:roleId', async (req, res) => {
  const auth = mustAuth(req);
  await servers.deleteRole(req.params.id!, req.params.roleId!, auth.id);
  res.json({ ok: true });
});

serversRouter.put(
  '/:id/members/:userId/roles',
  validateBody(memberRoleAssignSchema),
  async (req, res) => {
    const auth = mustAuth(req);
    await servers.setMemberRoles(req.params.id!, req.params.userId!, req.body.roleIds, auth.id);
    res.json({ ok: true });
  },
);

// ── Public invite endpoints ───────────────────────────────────────────────────

export const invitesRouter = Router();

invitesRouter.get('/:code', async (req, res) => {
  const invite = await servers.previewInvite(req.params.code!);
  res.json({ invite });
});

invitesRouter.post('/:code/join', requireAuth, async (req, res) => {
  const auth = mustAuth(req);
  const result = await servers.joinByInvite(req.params.code!, auth.id);
  res.json(result);
});

invitesRouter.delete('/:code', requireAuth, async (req, res) => {
  const auth = mustAuth(req);
  await servers.revokeInvite(req.params.code!, auth.id);
  res.json({ ok: true });
});
