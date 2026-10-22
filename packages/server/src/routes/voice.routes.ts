import { Router } from 'express';
import { z } from 'zod';
import { mustAuth, requireAuth } from '../middleware/auth.js';
import { voice } from '../services/voice.service.js';

export const voiceRouter = Router();
voiceRouter.use(requireAuth);

voiceRouter.get('/status', (_req, res) => {
  res.json({ configured: voice.configured });
});

voiceRouter.post('/token', async (req, res) => {
  const auth = mustAuth(req);
  const parsed = z.object({ channelId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'channelId required' } });
  const result = await voice.issueToken(parsed.data.channelId, auth.id, auth.displayName);
  res.json(result);
});

voiceRouter.get('/channels/:channelId/participants', async (req, res) => {
  const auth = mustAuth(req);
  // Authorization happens through channel access.
  const { permissions: perms } = await (
    await import('../services/permission.service.js')
  ).permissions.getChannelContext(req.params.channelId!, auth.id);
  const { hasPermission, Permissions } = await import('@aether/shared');
  if (!hasPermission(perms, Permissions.VIEW_CHANNELS)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  }
  res.json({ participants: voice.participants(req.params.channelId!) });
});
