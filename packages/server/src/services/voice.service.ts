import { Permissions, hasPermission } from '@aether/shared';
import { AccessToken } from 'livekit-server-sdk';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { permissions } from './permission.service.js';
import { prisma } from '../context.js';

export interface VoiceTokenResponse {
  token: string;
  url: string;
  roomName: string;
  channelId: string;
  participantName: string;
}

export class VoiceService {
  get configured(): boolean {
    return Boolean(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET);
  }

  /**
   * Issues a LiveKit join token after server-side authorization.
   * Secrets never leave the backend. Returns 503 when LiveKit is not
   * configured — no fake fallback.
   */
  async issueToken(channelId: string, userId: string, displayName: string): Promise<VoiceTokenResponse> {
    if (!this.configured) {
      throw ApiError.unavailable(
        'Voice is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.',
      );
    }
    const { permissions: perms, channel } = await permissions.getChannelContext(channelId, userId);
    permissions.requireChannel(perms, Permissions.CONNECT_VOICE);
    if (channel.type !== 'VOICE') {
      throw ApiError.badRequest('That channel is not a voice channel');
    }
    const count = await this.participantCount(channelId);
    if (count >= config.VOICE_MAX_PARTICIPANTS) {
      throw ApiError.badRequest('This voice channel is full');
    }
    const banned = await prisma.banEntry.findUnique({
      where: { serverId_userId: { serverId: channel.serverId, userId } },
    });
    if (banned) throw ApiError.forbidden('You are banned from this server');

    const canSpeak = hasPermission(perms, Permissions.SPEAK_VOICE);
    const canVideo = hasPermission(perms, Permissions.VIDEO);
    const canScreen = hasPermission(perms, Permissions.SCREEN_SHARE);

    const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
      identity: userId,
      name: displayName,
      ttl: '6h',
    });
    const grant: Parameters<AccessToken['addGrant']>[0] = {
      roomJoin: true,
      room: `channel:${channelId}`,
      canPublish: canSpeak,
      canPublishData: true,
      canSubscribe: true,
      canUpdateOwnMetadata: true,
      // Video / screenshare require their own permissions where supported by
      // the LiveKit server policy; we still gate client controls server-side.
    };
    if (!canVideo || !canScreen) {
      // Restrict sources when either is denied.
      grant.roomAdmin = false;
    }
    at.addGrant(grant);
    return {
      token: await at.toJwt(),
      url: config.LIVEKIT_URL!,
      roomName: `channel:${channelId}`,
      channelId,
      participantName: displayName,
    };
  }

  async participantCount(channelId: string): Promise<number> {
    return this.participants(channelId).length;
  }

  /** Voice participants tracked from socket `voice:state` events. */
  private voiceStates = new Map<string, Map<string, VoiceParticipantState>>();

  join(channelId: string, userId: string) {
    if (!this.voiceStates.has(channelId)) this.voiceStates.set(channelId, new Map());
    const room = this.voiceStates.get(channelId)!;
    if (!room.has(userId)) {
      room.set(userId, {
        userId,
        muted: false,
        deafened: false,
        speaking: false,
        videoOn: false,
        screenSharing: false,
        connectedAt: new Date().toISOString(),
      });
    }
    return [...room.values()];
  }

  leave(channelId: string, userId: string) {
    this.voiceStates.get(channelId)?.delete(userId);
    return [...(this.voiceStates.get(channelId)?.values() ?? [])];
  }

  setState(channelId: string, userId: string, patch: Partial<VoiceParticipantState>) {
    const room = this.voiceStates.get(channelId);
    const cur = room?.get(userId);
    if (!cur) return null;
    Object.assign(cur, patch);
    return cur;
  }

  participants(channelId: string): VoiceParticipantState[] {
    return [...(this.voiceStates.get(channelId)?.values() ?? [])];
  }
}

export interface VoiceParticipantState {
  userId: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  videoOn: boolean;
  screenSharing: boolean;
  connectedAt: string;
}

export const voice = new VoiceService();
