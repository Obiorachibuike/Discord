'use client';

import * as React from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  Headphones,
  Signal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, Tooltip } from '@/components/ui/primitives';
import { Button, Spinner, Badge, EmptyState } from '@/components/ui/input';
import { apiGet, apiPost } from '@/lib/api';

interface Participant {
  identity: string;
  name?: string;
  isSpeaking: boolean;
  isMuted: boolean;
  hasVideo: boolean;
  isScreenShare: boolean;
  videoTrack?: MediaStreamTrack;
}

interface TokenResponse {
  token: string;
  url: string;
  roomName: string;
  channelId: string;
}

/**
 * Voice/video room powered by LiveKit. Requires LIVEKIT_* configuration on the
 * backend; when unconfigured we surface the backend's explicit error instead of
 * faking a call.
 */
export function VoicePanel({
  channelId,
  channelName,
  onLeave,
}: {
  channelId: string;
  channelName?: string;
  onLeave?: () => void;
}) {
  const [state, setState] = React.useState<
    'idle' | 'connecting' | 'connected' | 'unconfigured' | 'error'
  >('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [participants, setParticipants] = React.useState<Participant[]>([]);
  const [muted, setMuted] = React.useState(false);
  const [videoOn, setVideoOn] = React.useState(false);
  const [screenSharing, setScreenSharing] = React.useState(false);
  const roomRef = React.useRef<{
    localParticipant: {
      setMicrophoneEnabled: (v: boolean) => Promise<unknown>;
      setCameraEnabled: (v: boolean) => Promise<unknown>;
      setScreenShareEnabled: (v: boolean) => Promise<unknown>;
      name?: string;
    };
    disconnect: () => Promise<void>;
    on: (event: string, cb: (...args: never[]) => void) => void;
  } | null>(null);

  const refreshParticipants = React.useCallback(() => {
    const room = roomRef.current;
    if (!room || !('participants' in room)) return;
    // livekit Room.remoteParticipants is a Map
    const remote = (
      room as unknown as {
        remoteParticipants: Map<
          string,
          {
            identity: string;
            name?: string;
            isSpeaking: boolean;
            audioTrackPublications: Map<string, { isMuted?: boolean }>;
            videoTrackPublications: Map<string, { isMuted?: boolean; track?: { mediaStreamTrack: MediaStreamTrack } }>;
          }
        >;
        localParticipant: {
          identity: string;
          name?: string;
          isSpeaking: boolean;
          audioTrackPublications: Map<string, { isMuted?: boolean }>;
          videoTrackPublications: Map<string, { isMuted?: boolean; track?: { mediaStreamTrack: MediaStreamTrack } }>;
        };
      }
    );
    const list: Participant[] = [];
    const mapPerson = (p: typeof remote.localParticipant, isScreenShare = false): Participant => {
      const audio = [...p.audioTrackPublications.values()][0];
      const video = [...p.videoTrackPublications.values()][0];
      return {
        identity: p.identity,
        name: p.name ?? p.identity,
        isSpeaking: p.isSpeaking,
        isMuted: audio?.isMuted ?? true,
        hasVideo: Boolean(video && !video.isMuted),
        isScreenShare,
        videoTrack: video?.track?.mediaStreamTrack,
      };
    };
    list.push(mapPerson(remote.localParticipant));
    for (const p of remote.remoteParticipants.values()) {
      list.push(mapPerson(p as unknown as typeof remote.localParticipant));
    }
    setParticipants(list);
  }, []);

  const join = React.useCallback(async () => {
    setState('connecting');
    try {
      const status = await apiGet<{ configured: boolean }>('/api/voice/status');
      if (!status.configured) {
        setState('unconfigured');
        return;
      }
      const tok = await apiPost<TokenResponse>('/api/voice/token', { channelId });
      const { Room, RoomEvent, Track } = await import('livekit-client');
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room as unknown as typeof roomRef.current;
      room.on(RoomEvent.Connected, () => {
        setState('connected');
        refreshParticipants();
      });
      room.on(RoomEvent.ParticipantConnected, refreshParticipants);
      room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
      room.on(RoomEvent.TrackSubscribed, refreshParticipants);
      room.on(RoomEvent.TrackUnsubscribed, refreshParticipants);
      room.on(RoomEvent.ActiveSpeakersChanged, refreshParticipants);
      room.on(RoomEvent.Disconnected, () => {
        setState('idle');
        setParticipants([]);
      });
      await room.connect(tok.url, tok.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      void Track;
    } catch (err) {
      const msg = (err as Error).message || 'Could not join voice';
      setError(msg);
      setState(msg.includes('not configured') ? 'unconfigured' : 'error');
    }
  }, [channelId, refreshParticipants]);

  const leave = React.useCallback(async () => {
    await roomRef.current?.disconnect().catch(() => undefined);
    roomRef.current = null;
    setState('idle');
    setVideoOn(false);
    setScreenSharing(false);
    onLeave?.();
  }, [onLeave]);

  React.useEffect(() => {
    return () => {
      void roomRef.current?.disconnect().catch(() => undefined);
    };
  }, []);

  const toggleMute = async () => {
    const next = !muted;
    setMuted(next);
    await roomRef.current?.localParticipant.setMicrophoneEnabled(!next).catch(() => undefined);
  };

  const toggleVideo = async () => {
    const next = !videoOn;
    setVideoOn(next);
    await roomRef.current?.localParticipant.setCameraEnabled(next).catch(() => undefined);
    refreshParticipants();
  };

  const toggleScreen = async () => {
    const next = !screenSharing;
    setScreenSharing(next);
    await roomRef.current?.localParticipant.setScreenShareEnabled(next).catch(() => undefined);
    refreshParticipants();
  };

  if (state === 'idle') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <EmptyState
          title={`Join ${channelName ? `#${channelName}` : 'voice'}`}
          description="Voice and video run over LiveKit WebRTC. Your microphone starts muted until you enable it."
        />
        <Button onClick={() => void join()} size="lg">
          <Headphones className="h-4 w-4" /> Join voice
        </Button>
      </div>
    );
  }

  if (state === 'connecting') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Spinner className="h-8 w-8" />
        <p className="text-sm text-muted-foreground">Connecting to voice…</p>
      </div>
    );
  }

  if (state === 'unconfigured') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Signal className="h-10 w-10 text-warning" />
        <h3 className="text-lg font-semibold">Voice is not configured</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          Set <code className="rounded bg-muted px-1">LIVEKIT_URL</code>,{' '}
          <code className="rounded bg-muted px-1">LIVEKIT_API_KEY</code> and{' '}
          <code className="rounded bg-muted px-1">LIVEKIT_API_SECRET</code> on the backend to enable
          voice, video and screen sharing. See DEPLOYMENT.md for setup with LiveKit Cloud or
          self-hosted LiveKit.
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <PhoneOff className="h-10 w-10 text-danger" />
        <h3 className="text-lg font-semibold">Could not join voice</h3>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => void join()}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Signal className="h-4 w-4 text-success" />
          <h2 className="text-sm font-semibold">{channelName ? `#${channelName}` : 'Voice'}</h2>
          <Badge variant="success">connected</Badge>
        </div>
        <span className="text-xs text-muted-foreground">{participants.length} participant(s)</span>
      </div>

      <div className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2 scroll-thin">
        {participants.map((p) => (
          <div
            key={p.identity}
            className={cn(
              'relative aspect-video overflow-hidden rounded-lg border bg-surface-raised',
              p.isSpeaking && 'ring-2 ring-success',
            )}
          >
            {p.hasVideo && p.videoTrack ? (
              <VideoTrackView track={p.videoTrack} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <Avatar name={p.name ?? p.identity} size="lg" />
                <p className="text-sm font-medium">{p.name ?? p.identity}</p>
              </div>
            )}
            <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-xs text-white">
              {p.isMuted ? <MicOff className="h-3 w-3 text-danger" /> : <Mic className="h-3 w-3" />}
              {p.name ?? p.identity}
            </div>
            {p.isScreenShare ? (
              <div className="absolute right-2 top-2">
                <Badge>screen</Badge>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2 border-t px-4 py-4">
        <Tooltip label={muted ? 'Unmute' : 'Mute'} side="top">
          <button
            onClick={() => void toggleMute()}
            className={cn(
              'rounded-full p-3 transition-colors',
              muted ? 'bg-danger/15 text-danger' : 'bg-muted hover:bg-muted/70',
            )}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
        </Tooltip>
        <Tooltip label={videoOn ? 'Stop camera' : 'Start camera'} side="top">
          <button
            onClick={() => void toggleVideo()}
            className={cn(
              'rounded-full p-3 transition-colors',
              videoOn ? 'bg-accent text-accent-foreground' : 'bg-muted hover:bg-muted/70',
            )}
            aria-label="Toggle camera"
          >
            {videoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </button>
        </Tooltip>
        <Tooltip label={screenSharing ? 'Stop sharing' : 'Share your screen'} side="top">
          <button
            onClick={() => void toggleScreen()}
            className={cn(
              'rounded-full p-3 transition-colors',
              screenSharing ? 'bg-accent text-accent-foreground' : 'bg-muted hover:bg-muted/70',
            )}
            aria-label="Toggle screen share"
          >
            <MonitorUp className="h-5 w-5" />
          </button>
        </Tooltip>
        <Tooltip label="Leave voice" side="top">
          <button
            onClick={() => void leave()}
            className="rounded-full bg-danger p-3 text-white transition-colors hover:bg-danger/90"
            aria-label="Leave voice"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function VideoTrackView({ track }: { track: MediaStreamTrack }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = new MediaStream([track]);
    }
  }, [track]);
  return (
    <video ref={ref} autoPlay playsInline className="h-full w-full object-cover" />
  );
}
