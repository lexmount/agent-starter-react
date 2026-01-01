import React, { useMemo } from 'react';
import { Track } from 'livekit-client';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarVisualizer,
  type TrackReference,
  VideoTrack,
  useLocalParticipant,
  useTracks,
} from '@livekit/components-react';
import { APP_CONFIG_DEFAULTS } from '@/app-config';
import { useSmartVoiceAssistant } from '@/hooks/useSmartVoiceAssistant';
import { useSelectedVideoTrack } from '@/hooks/useSelectedVideoTrack';
import { cn } from '@/lib/utils';

const MotionContainer = motion.create('div');

const ANIMATION_TRANSITION = {
  type: 'spring',
  stiffness: 675,
  damping: 75,
  mass: 1,
};

const classNames = {
  // GRID
  // 2 Columns x 3 Rows
  grid: [
    'h-full w-full',
    'grid gap-x-2 place-content-center',
    'grid-cols-[1fr_1fr] grid-rows-[270px_1fr_270px]',
  ],
  // Agent
  // chatOpen: true,
  // hasSecondTile: true
  // layout: Column 1 / Row 1
  // align: x-end y-center
  agentChatOpenWithSecondTile: ['col-start-1 row-start-1', 'self-center justify-self-end'],
  // Agent
  // chatOpen: true,
  // hasSecondTile: false
  // layout: Column 1 / Row 1 / Column-Span 2
  // align: x-center y-center
  agentChatOpenWithoutSecondTile: ['col-start-1 row-start-1', 'col-span-2', 'place-content-center'],
  // Agent
  // chatOpen: false
  // layout: Column 1 / Row 1 / Column-Span 2 / Row-Span 3
  // align: x-center y-center
  agentChatClosed: ['col-start-1 row-start-1', 'col-span-2 row-span-3', 'place-content-center'],
  // Second tile
  // chatOpen: true,
  // hasSecondTile: true
  // layout: Column 2 / Row 1
  // align: x-start y-center
  secondTileChatOpen: ['col-start-2 row-start-1', 'self-center justify-self-start'],
  // Second tile
  // chatOpen: false,
  // hasSecondTile: false
  // layout: Column 2 / Row 2
  // align: x-end y-end
  secondTileChatClosed: ['col-start-2 row-start-3', 'place-content-end'],
};

export function useLocalTrackRef(source: Track.Source) {
  const { localParticipant } = useLocalParticipant();
  const publication = localParticipant.getTrackPublication(source);
  const trackRef = useMemo<TrackReference | undefined>(
    () => (publication ? { source, participant: localParticipant, publication } : undefined),
    [source, publication, localParticipant]
  );
  return trackRef;
}

interface TileLayoutProps {
  chatOpen: boolean;
}

export function TileLayout({ chatOpen }: TileLayoutProps) {
  const {
    state: agentState,
    audioTrack: agentAudioTrack,
    videoTrack: agentVideoTrack,
  } = useSmartVoiceAssistant({
    videoTrackConfigs: APP_CONFIG_DEFAULTS.availableVideoTracks,
  });
  const [screenShareTrack] = useTracks([Track.Source.ScreenShare]);
  const defaultCameraTrack: TrackReference | undefined = useLocalTrackRef(Track.Source.Camera);
  
  // 获取选中的视频轨道（可能是远程轨道）
  const { trackReference: selectedTrack } = useSelectedVideoTrack();
  
  // 简化逻辑：只有在有选中的轨道时才显示摄像头预览
  const cameraTrack = selectedTrack;

  const isCameraEnabled = cameraTrack && cameraTrack.publication && !cameraTrack.publication.isMuted;
  const isScreenShareEnabled = screenShareTrack && !screenShareTrack.publication.isMuted;
  const hasSecondTile = isCameraEnabled || isScreenShareEnabled;

  const animationDelay = chatOpen ? 0 : 0.15;
  const isAvatar = agentVideoTrack !== undefined;
  const videoWidth = agentVideoTrack?.publication.dimensions?.width ?? 0;
  const videoHeight = agentVideoTrack?.publication.dimensions?.height ?? 0;

  // 调试日志
  console.log('[TileLayout] Camera track:', {
    selectedTrack: selectedTrack ? selectedTrack.publication?.trackName : null,
    cameraTrack: cameraTrack ? cameraTrack.publication?.trackName : null,
    isCameraEnabled,
    hasPublication: !!cameraTrack?.publication,
    isMuted: cameraTrack?.publication?.isMuted,
  });

  return (
    <div className="pointer-events-none fixed inset-x-0 top-8 bottom-32 z-50 md:top-12 md:bottom-40">
      <div className="relative mx-auto h-full max-w-2xl px-4 md:px-0">
        <div className={cn(classNames.grid)}>
          {/* Agent */}
          <div
            className={cn([
              'grid',
              !chatOpen && classNames.agentChatClosed,
              chatOpen && hasSecondTile && classNames.agentChatOpenWithSecondTile,
              chatOpen && !hasSecondTile && classNames.agentChatOpenWithoutSecondTile,
            ])}
          >
            <AnimatePresence mode="popLayout">
              {!isAvatar && (
                // Audio Agent
                <MotionContainer
                  key="agent"
                  layoutId="agent"
                  initial={{
                    opacity: 0,
                    scale: 0,
                  }}
                  animate={{
                    opacity: 1,
                    scale: chatOpen ? 1 : 5,
                  }}
                  transition={{
                    ...ANIMATION_TRANSITION,
                    delay: animationDelay,
                  }}
                  className={cn(
                    'bg-background h-[270px] w-[360px] rounded-md border border-transparent transition-[border,drop-shadow]',
                    chatOpen && 'border-input/50 drop-shadow-lg/10 delay-200'
                  )}
                >
                  <BarVisualizer
                    barCount={5}
                    state={agentState}
                    options={{ minHeight: 5 }}
                    trackRef={agentAudioTrack}
                    className={cn('flex h-full items-center justify-center gap-1')}
                  >
                    <span
                      className={cn([
                        'bg-muted min-h-2.5 w-2.5 rounded-full',
                        'origin-center transition-colors duration-250 ease-linear',
                        'data-[lk-highlighted=true]:bg-foreground data-[lk-muted=true]:bg-muted',
                      ])}
                    />
                  </BarVisualizer>
                </MotionContainer>
              )}

              {isAvatar && (
                // Avatar Agent
                <MotionContainer
                  key="avatar"
                  layoutId="avatar"
                  initial={{
                    scale: 1,
                    opacity: 1,
                    maskImage:
                      'radial-gradient(circle, rgba(0, 0, 0, 1) 0, rgba(0, 0, 0, 1) 20px, transparent 20px)',
                    filter: 'blur(20px)',
                  }}
                  animate={{
                    maskImage:
                      'radial-gradient(circle, rgba(0, 0, 0, 1) 0, rgba(0, 0, 0, 1) 500px, transparent 500px)',
                    filter: 'blur(0px)',
                    borderRadius: chatOpen ? 6 : 12,
                  }}
                  transition={{
                    ...ANIMATION_TRANSITION,
                    delay: animationDelay,
                    maskImage: {
                      duration: 1,
                    },
                    filter: {
                      duration: 1,
                    },
                  }}
                  className={cn(
                    'overflow-hidden bg-black drop-shadow-xl/80',
                    chatOpen ? 'h-[270px] w-[360px]' : 'h-auto w-full'
                  )}
                >
                  <VideoTrack
                    width={videoWidth}
                    height={videoHeight}
                    trackRef={agentVideoTrack}
                    className={cn(chatOpen && 'h-[270px] w-[360px] object-cover')}
                  />
                </MotionContainer>
              )}
            </AnimatePresence>
          </div>

          <div
            className={cn([
              'grid',
              chatOpen && classNames.secondTileChatOpen,
              !chatOpen && classNames.secondTileChatClosed,
            ])}
          >
            {/* Camera & Screen Share */}
            <AnimatePresence>
              {((cameraTrack && isCameraEnabled) || (screenShareTrack && isScreenShareEnabled)) && (
                <MotionContainer
                  key="camera"
                  layout="position"
                  layoutId="camera"
                  initial={{
                    opacity: 0,
                    scale: 0,
                  }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                  }}
                  exit={{
                    opacity: 0,
                    scale: 0,
                  }}
                  transition={{
                    ...ANIMATION_TRANSITION,
                    delay: animationDelay,
                  }}
                  className="drop-shadow-lg/20"
                >
                  <VideoTrack
                    trackRef={cameraTrack || screenShareTrack}
                    width={(cameraTrack || screenShareTrack)?.publication.dimensions?.width ?? 0}
                    height={(cameraTrack || screenShareTrack)?.publication.dimensions?.height ?? 0}
                    className="bg-muted h-[270px] w-[360px] rounded-md object-cover"
                  />
                </MotionContainer>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
