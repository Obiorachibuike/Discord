import { Router } from 'express';
import { AccessToken, RoomServiceClient, WebhookReceiver, TrackSource } from 'livekit-server-sdk';
import { db } from '@cove/db';
import { id } from '@cove/shared';
import { config } from '../lib/config';
import { HttpError, route } from '../lib/errors';
import { canChannel, requireChannel, requireConversation } from '../services/permissions';
import { emitRoom } from '../services/notifications';
const router = Router();
function service() {
  if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) throw new HttpError(503, 'LIVEKIT_UNAVAILABLE', 'Calls are unavailable until LiveKit is configured.');
  return new RoomServiceClient(config.LIVEKIT_URL.replace(/^ws/, 'http'), config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
}
async function tokenFor(userId: string, room: string, grants: { speak: boolean; video: boolean; screen: boolean }, limit: number) {
  const livekit = service();
  const rooms = await livekit.listRooms([room]);
  if (!rooms.length) await livekit.createRoom({ name: room, maxParticipants: limit, emptyTimeout: 60 }).catch(async () => {
    if (!(await livekit.listRooms([room])).length) throw new HttpError(503, 'LIVEKIT_UNAVAILABLE', 'Could not create call room.');
  });
  const participants = await livekit.listParticipants(room);
  if (participants.length >= limit && !participants.some(p => p.identity === userId)) throw new HttpError(409, 'ROOM_FULL', 'This call is full.');
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { identity: userId, name: user.displayName, ttl: '1h' });
  token.addGrant({ roomJoin: true, room, canSubscribe: true, canPublish: grants.speak || grants.video || grants.screen,
    canPublishData: false, canPublishSources: [grants.speak && TrackSource.MICROPHONE, grants.video && TrackSource.CAMERA, grants.screen && TrackSource.SCREEN_SHARE, grants.screen && TrackSource.SCREEN_SHARE_AUDIO].filter((source): source is TrackSource => typeof source === 'number') });
  return { token: await token.toJwt(), url: config.LIVEKIT_URL, room, permissions: grants };
}
router.post('/channels/:channelId/token', route(async (req, res) => {
  const channelId = id.parse(req.params.channelId);
  const { channel, ctx } = await requireChannel(req.auth!.userId, channelId, 'CONNECT_VOICE');
  if (channel.kind !== 'VOICE') throw new HttpError(400, 'WRONG_CHANNEL_TYPE', 'Choose a voice channel.');
  res.json(await tokenFor(req.auth!.userId, `voice:${channelId}`, { speak: canChannel(ctx, channel, 'SPEAK'), video: canChannel(ctx, channel, 'SHARE_VIDEO'), screen: canChannel(ctx, channel, 'SHARE_SCREEN') }, channel.userLimit || 50));
}));
router.get('/channels/:channelId/participants', route(async (req, res) => {
  const channelId = id.parse(req.params.channelId);
  const { channel } = await requireChannel(req.auth!.userId, channelId, 'VIEW_CHANNEL');
  if (channel.kind !== 'VOICE') throw new HttpError(400, 'WRONG_CHANNEL_TYPE', 'Choose a voice channel.');
  const participants = await service().listParticipants(`voice:${channelId}`);
  res.json({ participants: participants.map(p => ({ identity: p.identity, name: p.name, joinedAt: p.joinedAt })) });
}));
router.post('/conversations/:conversationId/token', route(async (req, res) => {
  const conversationId = id.parse(req.params.conversationId);
  const conversation = await requireConversation(req.auth!.userId, conversationId, true);
  res.json(await tokenFor(req.auth!.userId, `call:${conversationId}`, { speak: true, video: true, screen: true }, conversation.kind === 'DIRECT' ? 2 : 20));
}));
// Signed LiveKit webhook; no browser session. Body must be preserved as raw bytes.
router.post('/webhook', route(async (req, res) => {
  if (!config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) throw new HttpError(503, 'LIVEKIT_UNAVAILABLE', 'LiveKit is not configured.');
  const receiver = new WebhookReceiver(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  const event = await receiver.receive(req.body.toString('utf8'), req.get('authorization')).catch(() => { throw new HttpError(401, 'INVALID_WEBHOOK', 'Invalid webhook signature.'); });
  if (['participant_joined','participant_left'].includes(event.event) && event.room?.name && event.participant?.identity) {
    const room = event.room.name;
    // Only accept our own room namespace, never broadcast untrusted arbitrary room strings.
    if (/^(voice|call):[\da-f-]{36}$/.test(room)) {
      const targetId = room.split(':')[1];
      const safeRoom = room.startsWith('voice:') ? `channel:${targetId}` : `conversation:${targetId}`;
      emitRoom(safeRoom, 'voice:updated', { room, participantId: event.participant.identity, joined: event.event === 'participant_joined' });
    }
  }
  res.status(204).send();
}));
export default router;
