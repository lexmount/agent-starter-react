'use client';

import { type HTMLAttributes, useCallback, useMemo, useState } from 'react';
import { Track } from 'livekit-client';
import { useChat, useRemoteParticipants } from '@livekit/components-react';
import { ChatTextIcon, PhoneDisconnectIcon } from '@phosphor-icons/react/dist/ssr';
import { useSession } from '@/components/app/session-provider';
import { TrackToggle } from '@/components/livekit/agent-control-bar/track-toggle';
import { Button } from '@/components/livekit/button';
import { Toggle } from '@/components/livekit/toggle';
import { cn } from '@/lib/utils';
import { ChatInput } from './chat-input';
import { ConfigurableVideoSelector } from './configurable-video-selector';
import { UseInputControlsProps, useInputControls } from './hooks/use-input-controls';
import { usePublishPermissions } from './hooks/use-publish-permissions';
import { TrackSelector } from './track-selector';

const BROWSER_VIDEO_TRACK_NAME = 'browser_video_track';

export interface ControlBarControls {
  leave?: boolean;
  camera?: boolean;
  microphone?: boolean;
  screenShare?: boolean;
  chat?: boolean;
}

export interface AgentControlBarProps extends UseInputControlsProps {
  controls?: ControlBarControls;
  onDisconnect?: () => void;
  onChatOpenChange?: (open: boolean) => void;
  onDeviceError?: (error: { source: Track.Source; error: Error }) => void;
}

/**
 * A control bar specifically designed for voice assistant interfaces
 */
export function AgentControlBar({
  controls,
  saveUserChoices = true,
  className,
  onDisconnect,
  onDeviceError,
  onChatOpenChange,
  ...props
}: AgentControlBarProps & HTMLAttributes<HTMLDivElement>) {
  const { send } = useChat();
  const participants = useRemoteParticipants();
  const [chatOpen, setChatOpen] = useState(false);
  const publishPermissions = usePublishPermissions();
  const { appConfig, isSessionActive, endSession, browserSourceClient } = useSession();
  const usesBrowserRawMediaInput =
    !!appConfig.usesBrowserRawMediaInput && browserSourceClient.enabled;
  const browserRawVideoTracks = useMemo(() => {
    if (!usesBrowserRawMediaInput || !browserSourceClient.videoTrack) {
      return undefined;
    }

    return new Map([[BROWSER_VIDEO_TRACK_NAME, browserSourceClient.videoTrack]]);
  }, [usesBrowserRawMediaInput, browserSourceClient.videoTrack]);

  const {
    micTrackRef,
    cameraToggle,
    microphoneToggle,
    screenShareToggle,
    handleAudioDeviceChange,
    handleVideoDeviceChange,
    handleMicrophoneDeviceSelectError,
    handleCameraDeviceSelectError,
  } = useInputControls({ onDeviceError, saveUserChoices });

  const handleSendMessage = async (message: string) => {
    await send(message);
  };

  const handleToggleTranscript = useCallback(
    (open: boolean) => {
      setChatOpen(open);
      onChatOpenChange?.(open);
    },
    [onChatOpenChange, setChatOpen]
  );

  const handleDisconnect = useCallback(async () => {
    endSession();
    onDisconnect?.();
  }, [endSession, onDisconnect]);

  const handleRawMicrophoneToggle = useCallback(
    (enabled: boolean) => {
      void browserSourceClient.setAudioEnabled(enabled).catch((error) => {
        onDeviceError?.({ source: Track.Source.Microphone, error });
      });
    },
    [browserSourceClient, onDeviceError]
  );

  const handleRawVideoToggle = useCallback(
    async (enabled: boolean) => {
      try {
        await browserSourceClient.setVideoEnabled(enabled);
      } catch (error) {
        onDeviceError?.({ source: Track.Source.Camera, error: error as Error });
      }
    },
    [browserSourceClient, onDeviceError]
  );

  const visibleControls = {
    leave: controls?.leave ?? true,
    microphone: controls?.microphone ?? publishPermissions.microphone,
    screenShare: controls?.screenShare ?? publishPermissions.screenShare,
    camera: controls?.camera ?? publishPermissions.camera,
    chat: controls?.chat ?? publishPermissions.data,
  };

  const isAgentAvailable = participants.some((p) => p.isAgent);

  return (
    <div
      aria-label="Voice assistant controls"
      className={cn(
        'bg-background border-input/50 dark:border-muted flex flex-col rounded-[31px] border p-3 drop-shadow-md/3',
        className
      )}
      {...props}
    >
      {/* Chat Input */}
      {visibleControls.chat && (
        <ChatInput
          chatOpen={chatOpen}
          isAgentAvailable={isAgentAvailable}
          onSend={handleSendMessage}
        />
      )}

      <div className="flex gap-1">
        <div className="flex grow gap-1">
          {/* Toggle Microphone */}
          {visibleControls.microphone && (
            <TrackSelector
              kind="audioinput"
              aria-label="Toggle microphone"
              source={Track.Source.Microphone}
              pressed={
                usesBrowserRawMediaInput
                  ? browserSourceClient.audioEnabled
                  : microphoneToggle.enabled
              }
              disabled={
                usesBrowserRawMediaInput
                  ? !isSessionActive || browserSourceClient.audioPending
                  : microphoneToggle.pending
              }
              audioTrackRef={usesBrowserRawMediaInput ? undefined : micTrackRef}
              onPressedChange={
                usesBrowserRawMediaInput ? handleRawMicrophoneToggle : microphoneToggle.toggle
              }
              onMediaDeviceError={handleMicrophoneDeviceSelectError}
              onActiveDeviceChange={handleAudioDeviceChange}
            />
          )}

          {/* Configurable Video Selector */}
          {visibleControls.camera && (
            <ConfigurableVideoSelector
              availableConfigs={appConfig.availableVideoTracks}
              defaultTrackId={appConfig.defaultVideoTrack}
              existingLivekitTracks={browserRawVideoTracks}
              pressed={cameraToggle.enabled}
              pending={cameraToggle.pending}
              disabled={cameraToggle.pending}
              mediaEnabled={usesBrowserRawMediaInput ? browserSourceClient.videoEnabled : undefined}
              mediaPending={usesBrowserRawMediaInput ? browserSourceClient.videoPending : undefined}
              autoPreviewLivekitTracks={!usesBrowserRawMediaInput}
              onMediaEnabledChange={usesBrowserRawMediaInput ? handleRawVideoToggle : undefined}
              onPressedChange={cameraToggle.toggle}
              onMediaDeviceError={handleCameraDeviceSelectError}
              onTrackChange={handleVideoDeviceChange}
            />
          )}

          {/* Toggle Screen Share */}
          {visibleControls.screenShare && (
            <TrackToggle
              size="icon"
              variant="secondary"
              aria-label="Toggle screen share"
              source={Track.Source.ScreenShare}
              pressed={screenShareToggle.enabled}
              disabled={screenShareToggle.pending}
              onPressedChange={screenShareToggle.toggle}
            />
          )}

          {/* Toggle Transcript */}
          <Toggle
            size="icon"
            variant="secondary"
            aria-label="Toggle transcript"
            pressed={chatOpen}
            onPressedChange={handleToggleTranscript}
          >
            <ChatTextIcon weight="bold" />
          </Toggle>
        </div>

        {/* Disconnect */}
        {visibleControls.leave && (
          <Button
            variant="destructive"
            onClick={handleDisconnect}
            disabled={!isSessionActive}
            className="font-mono"
          >
            <PhoneDisconnectIcon weight="bold" />
            <span className="hidden md:inline">END CALL</span>
            <span className="inline md:hidden">END</span>
          </Button>
        )}
      </div>
    </div>
  );
}
