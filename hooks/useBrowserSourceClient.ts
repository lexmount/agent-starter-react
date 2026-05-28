'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LocalAudioTrack,
  LocalTrackPublication,
  LocalVideoTrack,
  Room,
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
} from 'livekit-client';
import { AppConfig } from '@/app-config';

const BROWSER_AUDIO_TRACK_NAME = 'browser_audio_track';
const BROWSER_VIDEO_TRACK_NAME = 'browser_video_track';
const BROWSER_MEDIA_STREAM_NAME =
  process.env.NEXT_PUBLIC_FRONTDESK_BROWSER_MEDIA_STREAM_NAME || 'browser_frontdesk_input';
const BROWSER_VIDEO_DEFAULT_ENABLED = true;
const BROWSER_VIDEO_FRAME_RATE = readNumberEnv(
  process.env.NEXT_PUBLIC_FRONTDESK_BROWSER_VIDEO_FPS,
  15
);
const BROWSER_VIDEO_MAX_BITRATE = readNumberEnv(
  process.env.NEXT_PUBLIC_FRONTDESK_BROWSER_VIDEO_MAX_BITRATE,
  1700000
);
const BROWSER_VIDEO_WIDTH = readNumberEnv(
  process.env.NEXT_PUBLIC_FRONTDESK_BROWSER_VIDEO_WIDTH,
  1280
);
const BROWSER_VIDEO_HEIGHT = readNumberEnv(
  process.env.NEXT_PUBLIC_FRONTDESK_BROWSER_VIDEO_HEIGHT,
  720
);

interface BrowserSourceRuntime {
  audioTrack: LocalAudioTrack | null;
  videoTrack: LocalVideoTrack | null;
  audioPublication: LocalTrackPublication | null;
  videoPublication: LocalTrackPublication | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export interface BrowserSourceClient {
  enabled: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  videoTrack: LocalVideoTrack | null;
  audioPending: boolean;
  videoPending: boolean;
  setAudioEnabled: (enabled: boolean) => Promise<void>;
  setVideoEnabled: (enabled: boolean) => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
}

interface BrowserSourceClientOptions {
  onVideoError?: (error: Error) => void;
}

export function useBrowserSourceClient(
  room: Room,
  appConfig: AppConfig,
  { onVideoError }: BrowserSourceClientOptions = {}
) {
  const runtimeRef = useRef<BrowserSourceRuntime | null>(null);
  const enabled = !!appConfig.usesBrowserRawMediaInput;
  const audioEnabledRef = useRef(true);
  const videoEnabledRef = useRef(BROWSER_VIDEO_DEFAULT_ENABLED);
  const [audioEnabled, setAudioEnabledState] = useState(true);
  const [videoEnabled, setVideoEnabledState] = useState(BROWSER_VIDEO_DEFAULT_ENABLED);
  const [videoTrack, setVideoTrackState] = useState<LocalVideoTrack | null>(null);
  const [audioPending, setAudioPending] = useState(false);
  const [videoPending, setVideoPending] = useState(false);

  const ensureAudioPublished = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.audioTrack || !runtime.audioEnabled) {
      return;
    }

    const audioTrack = await createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    audioTrack.mediaStreamTrack.enabled = runtime.audioEnabled;

    try {
      const publication = await room.localParticipant.publishTrack(audioTrack, {
        name: BROWSER_AUDIO_TRACK_NAME,
        source: Track.Source.Microphone,
        stream: BROWSER_MEDIA_STREAM_NAME,
      });
      runtime.audioTrack = audioTrack;
      runtime.audioPublication = publication;
    } catch (error) {
      audioTrack.stop();
      throw error;
    }
  }, [room]);

  const ensureVideoPublished = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.videoTrack || !runtime.videoEnabled) {
      return;
    }

    const videoTrack = await createLocalVideoTrack({
      facingMode: 'user',
      frameRate: { ideal: BROWSER_VIDEO_FRAME_RATE, max: BROWSER_VIDEO_FRAME_RATE },
      resolution: {
        width: BROWSER_VIDEO_WIDTH,
        height: BROWSER_VIDEO_HEIGHT,
        frameRate: BROWSER_VIDEO_FRAME_RATE,
      },
    });
    videoTrack.mediaStreamTrack.enabled = runtime.videoEnabled;

    try {
      const publication = await room.localParticipant.publishTrack(videoTrack, {
        name: BROWSER_VIDEO_TRACK_NAME,
        source: Track.Source.Camera,
        stream: BROWSER_MEDIA_STREAM_NAME,
        simulcast: false,
        degradationPreference: 'maintain-resolution',
        videoEncoding: {
          maxBitrate: BROWSER_VIDEO_MAX_BITRATE,
          maxFramerate: BROWSER_VIDEO_FRAME_RATE,
        },
      });
      runtime.videoTrack = videoTrack;
      runtime.videoPublication = publication;
      setVideoTrackState(videoTrack);
    } catch (error) {
      videoTrack.stop();
      throw error;
    }
  }, [room]);

  const unpublishAudio = useCallback(
    async (runtime: BrowserSourceRuntime) => {
      const track = runtime.audioTrack;
      runtime.audioTrack = null;
      runtime.audioPublication = null;
      if (!track) return;

      await room.localParticipant.unpublishTrack(track, true).catch(() => undefined);
      track.stop();
    },
    [room]
  );

  const unpublishVideo = useCallback(
    async (runtime: BrowserSourceRuntime) => {
      const track = runtime.videoTrack;
      runtime.videoTrack = null;
      runtime.videoPublication = null;
      setVideoTrackState(null);
      if (!track) return;

      await room.localParticipant.unpublishTrack(track, true).catch(() => undefined);
      track.stop();
    },
    [room]
  );

  const stop = useCallback(() => {
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    if (!runtime) return;

    void unpublishAudio(runtime);
    void unpublishVideo(runtime);
  }, [unpublishAudio, unpublishVideo]);

  const start = useCallback(async () => {
    if (!enabled || runtimeRef.current) {
      return;
    }

    runtimeRef.current = {
      audioTrack: null,
      videoTrack: null,
      audioPublication: null,
      videoPublication: null,
      audioEnabled: audioEnabledRef.current,
      videoEnabled: videoEnabledRef.current,
    };

    try {
      if (audioEnabledRef.current) {
        await ensureAudioPublished();
      }
    } catch (error) {
      stop();
      throw error;
    }

    if (videoEnabledRef.current) {
      try {
        await ensureVideoPublished();
      } catch (error) {
        videoEnabledRef.current = false;
        setVideoEnabledState(false);
        const runtime = runtimeRef.current;
        if (runtime) {
          runtime.videoEnabled = false;
        }
        onVideoError?.(error as Error);
      }
    }
  }, [enabled, ensureAudioPublished, ensureVideoPublished, onVideoError, stop]);

  const setAudioEnabled = useCallback(
    async (nextEnabled: boolean) => {
      setAudioPending(true);
      try {
        audioEnabledRef.current = nextEnabled;
        setAudioEnabledState(nextEnabled);

        const runtime = runtimeRef.current;
        if (!runtime) return;

        runtime.audioEnabled = nextEnabled;
        if (nextEnabled) {
          if (runtime.audioTrack) {
            runtime.audioTrack.mediaStreamTrack.enabled = true;
            await runtime.audioTrack.unmute();
          } else {
            await ensureAudioPublished();
          }
        } else if (runtime.audioTrack) {
          runtime.audioTrack.mediaStreamTrack.enabled = false;
          await runtime.audioTrack.mute();
        }
      } finally {
        setAudioPending(false);
      }
    },
    [ensureAudioPublished]
  );

  const setVideoEnabled = useCallback(
    async (nextEnabled: boolean) => {
      setVideoPending(true);
      try {
        videoEnabledRef.current = nextEnabled;
        setVideoEnabledState(nextEnabled);

        const runtime = runtimeRef.current;
        if (!runtime) return;

        runtime.videoEnabled = nextEnabled;
        if (nextEnabled) {
          await ensureVideoPublished();
          if (runtime.videoTrack) {
            runtime.videoTrack.mediaStreamTrack.enabled = true;
            await runtime.videoTrack.unmute();
          }
        } else {
          await unpublishVideo(runtime);
        }
      } finally {
        setVideoPending(false);
      }
    },
    [ensureVideoPublished, unpublishVideo]
  );

  useEffect(() => stop, [stop]);

  return useMemo(
    (): BrowserSourceClient => ({
      enabled,
      audioEnabled,
      videoEnabled,
      videoTrack,
      audioPending,
      videoPending,
      setAudioEnabled,
      setVideoEnabled,
      start,
      stop,
    }),
    [
      enabled,
      audioEnabled,
      videoEnabled,
      videoTrack,
      audioPending,
      videoPending,
      setAudioEnabled,
      setVideoEnabled,
      start,
      stop,
    ]
  );
}

function readNumberEnv(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
