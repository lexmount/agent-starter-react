'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalVideoTrack, type RemoteTrackPublication, Track } from 'livekit-client';
import {
  type TrackReference,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react';
import { BroadcastIcon, CameraIcon, WarningIcon, XIcon } from '@phosphor-icons/react/dist/ssr';
import { VideoTrackConfig } from '@/app-config';
import { TrackToggle } from '@/components/livekit/agent-control-bar/track-toggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/livekit/select';
import {
  type ConfigurableVideoTrackChange,
  useConfigurableVideoTracks,
} from '@/hooks/useConfigurableVideoTracks';
import {
  createRemoteVideoTrackReference,
  requestRemoteVideoHighQuality,
  useRemoteVideoTracks,
} from '@/hooks/useRemoteVideoTracks';
import { useSelectedVideoTrack } from '@/hooks/useSelectedVideoTrack';
import { cn } from '@/lib/utils';

const DEBUG_FRONTDESK_VIDEO = process.env.NEXT_PUBLIC_FRONTDESK_DEBUG_VIDEO === 'true';

function debugVideoLog(...args: unknown[]) {
  if (DEBUG_FRONTDESK_VIDEO) {
    console.log(...args);
  }
}

interface ConfigurableVideoSelectorProps {
  availableConfigs: VideoTrackConfig[];
  defaultTrackId?: string;
  existingLivekitTracks?: Map<string, LocalVideoTrack>;
  pressed?: boolean;
  pending?: boolean;
  disabled?: boolean;
  mediaEnabled?: boolean;
  mediaPending?: boolean;
  className?: string;
  onPressedChange?: (pressed: boolean) => void;
  onMediaEnabledChange?: (enabled: boolean) => Promise<void> | void;
  onMediaDeviceError?: (error: Error) => void;
  onTrackChange?: (trackId: string, track: ConfigurableVideoTrackChange) => void;
}

export function ConfigurableVideoSelector({
  availableConfigs,
  defaultTrackId,
  existingLivekitTracks,
  pressed,
  pending,
  disabled,
  mediaEnabled,
  mediaPending,
  className,
  onPressedChange,
  onMediaEnabledChange,
  onMediaDeviceError,
  onTrackChange,
}: ConfigurableVideoSelectorProps) {
  const { localParticipant } = useLocalParticipant();
  const {
    setSelectedTrack,
    clearSelectedTrack,
    trackId: selectedContextTrackId,
  } = useSelectedVideoTrack();
  const room = useRoomContext();
  const remoteVideoTracksApi = useRemoteVideoTracks();
  const { getTrackByName, subscribeToTrack } = remoteVideoTracksApi;

  // 分离的状态管理
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(defaultTrackId || null);
  const [isSystemCameraEnabled, setIsSystemCameraEnabled] = useState(false);
  const [isTrackPreviewEnabled, setIsTrackPreviewEnabled] = useState(false);
  const didAutoEnableLivekitPreview = useRef(false);
  const isMediaExternallyControlled =
    mediaEnabled !== undefined || onMediaEnabledChange !== undefined;
  const effectivePressed = isMediaExternallyControlled
    ? !!mediaEnabled
    : !!pressed || isSystemCameraEnabled || isTrackPreviewEnabled;

  const getLocalTrackReference = useCallback(
    (trackName: string): TrackReference | null => {
      const publications = Array.from(localParticipant.videoTrackPublications.values());
      const publication = publications.find(
        (item) => (item.trackName || item.trackSid) === trackName
      );

      if (!publication || publication.isMuted || !publication.track) {
        return null;
      }

      return {
        participant: localParticipant,
        source: publication.source,
        publication,
      };
    },
    [localParticipant]
  );

  const { videoOptions, currentTrack, isLoading, error, switchToTrack, getTrackById, clearError } =
    useConfigurableVideoTracks({
      availableConfigs,
      defaultTrackId,
      existingLivekitTracks,
      remoteVideoTracksApi,
      onTrackChange: async (trackId, trackOrTrackRef) => {
        debugVideoLog('[ConfigurableVideoSelector] Track changed:', trackId, trackOrTrackRef);
        debugVideoLog('[ConfigurableVideoSelector] TrackOrTrackRef type:', typeof trackOrTrackRef);
        debugVideoLog(
          '[ConfigurableVideoSelector] TrackOrTrackRef keys:',
          trackOrTrackRef ? Object.keys(trackOrTrackRef) : 'null'
        );

        const option = getTrackById(trackId);
        if (!option) {
          debugVideoLog('[ConfigurableVideoSelector] No option found for trackId:', trackId);
          return;
        }

        debugVideoLog('[ConfigurableVideoSelector] Processing track:', {
          trackId,
          type: option.config.type,
          label: option.label,
        });

        try {
          if (option.config.type === 'system' && trackOrTrackRef instanceof LocalVideoTrack) {
            // 系统摄像头：发布本地轨道
            debugVideoLog('[ConfigurableVideoSelector] Enabling system camera');

            const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
            if (currentCameraTrack?.track) {
              await localParticipant.unpublishTrack(currentCameraTrack.track);
            }

            await localParticipant.publishTrack(trackOrTrackRef, {
              source: Track.Source.Camera,
              name: trackId,
            });

            // 设置预览轨道
            const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
            if (!cameraPublication) {
              throw new Error('系统摄像头发布失败');
            }
            const trackRef: TrackReference = {
              participant: localParticipant,
              source: Track.Source.Camera,
              publication: cameraPublication,
            };
            setSelectedTrack(trackId, trackRef);
            setIsSystemCameraEnabled(true);
          } else if (option.config.type === 'livekit' && trackOrTrackRef) {
            // 远程轨道：直接使用远程轨道，不取消发布本地轨道
            debugVideoLog('[ConfigurableVideoSelector] Processing livekit track:', trackId);
            debugVideoLog('[ConfigurableVideoSelector] TrackOrTrackRef details:', {
              hasParticipant: 'participant' in trackOrTrackRef,
              hasPublication: 'publication' in trackOrTrackRef,
              hasSource: 'source' in trackOrTrackRef,
              keys: Object.keys(trackOrTrackRef),
            });

            debugVideoLog(
              '[ConfigurableVideoSelector] Setting selected track for livekit:',
              trackId
            );
            if (isTrackReference(trackOrTrackRef)) {
              if (isRemoteTrackPublication(trackOrTrackRef.publication)) {
                requestRemoteVideoHighQuality(trackOrTrackRef.publication);
              }
              setSelectedTrack(trackId, trackOrTrackRef);
            } else {
              const trackKey = option.config.livekitTrackName || option.config.id;
              const localTrackReference = getLocalTrackReference(trackKey);
              setSelectedTrack(trackId, localTrackReference);
            }
            setIsTrackPreviewEnabled(true);

            debugVideoLog(
              '[ConfigurableVideoSelector] Livekit track enabled, selectedTrack set:',
              trackId
            );
          } else {
            debugVideoLog(
              '[ConfigurableVideoSelector] Track type not handled:',
              option.config.type
            );
          }

          onTrackChange?.(trackId, trackOrTrackRef);
        } catch (err) {
          console.error('[ConfigurableVideoSelector] Failed to handle track change:', err);
          onMediaDeviceError?.(err as Error);
        }
      },
      onError: onMediaDeviceError,
    });

  // 清理系统摄像头资源
  const cleanupSystemCameraResources = useCallback(async () => {
    try {
      debugVideoLog('[ConfigurableVideoSelector] Cleaning up system camera resources');

      const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
      if (currentCameraTrack?.track) {
        await localParticipant.unpublishTrack(currentCameraTrack.track);
      }

      if (currentTrack instanceof LocalVideoTrack) {
        currentTrack.stop();
      }

      clearSelectedTrack();
      setIsSystemCameraEnabled(false);
    } catch (err) {
      console.error('[ConfigurableVideoSelector] Failed to cleanup system camera:', err);
    }
  }, [localParticipant, currentTrack, clearSelectedTrack]);

  // 清理所有资源
  const cleanupAllResources = useCallback(async () => {
    debugVideoLog('[ConfigurableVideoSelector] Complete cleanup - no state dependency');

    // 完全清理所有资源，不区分轨道类型
    if (!isMediaExternallyControlled) {
      const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
      if (currentCameraTrack?.track) {
        await localParticipant.unpublishTrack(currentCameraTrack.track);
      }
    }
    if (currentTrack instanceof LocalVideoTrack && !isMediaExternallyControlled) {
      currentTrack.stop();
    }
    clearSelectedTrack();
    setIsSystemCameraEnabled(false);
    setIsTrackPreviewEnabled(false);
    didAutoEnableLivekitPreview.current = false;
  }, [isMediaExternallyControlled, localParticipant, currentTrack, clearSelectedTrack]);

  // 系统摄像头开关逻辑
  const handleSystemCameraToggle = useCallback(
    async (enabled?: boolean) => {
      const shouldEnable = enabled !== undefined ? enabled : !isSystemCameraEnabled;

      if (shouldEnable) {
        debugVideoLog('[ConfigurableVideoSelector] Enabling system camera from scratch');

        // 先清理所有现有状态
        await cleanupAllResources();

        // 从头开始启用系统摄像头
        const systemTrackId = 'system_camera_default';
        setSelectedTrackId(systemTrackId);
        await switchToTrack(systemTrackId);

        setIsSystemCameraEnabled(true);
        onPressedChange?.(true);
      } else {
        debugVideoLog('[ConfigurableVideoSelector] Disabling system camera');

        // 完全清理系统摄像头资源
        await cleanupSystemCameraResources();

        setIsSystemCameraEnabled(false);
        onPressedChange?.(false);
      }
    },
    [
      cleanupAllResources,
      cleanupSystemCameraResources,
      isSystemCameraEnabled,
      switchToTrack,
      onPressedChange,
    ]
  );

  // 指定轨道预览开关逻辑
  const handleTrackPreviewToggle = useCallback(
    async (enabled?: boolean, trackIdOverride?: string) => {
      const shouldEnable = enabled !== undefined ? enabled : !isTrackPreviewEnabled;
      const trackToUse = trackIdOverride || selectedTrackId || defaultTrackId;

      if (shouldEnable) {
        debugVideoLog('[ConfigurableVideoSelector] Enabling track preview - FRESH START');

        // 根据轨道类型决定清理策略
        const option = trackToUse ? getTrackById(trackToUse) : null;
        if (option?.config.type === 'livekit') {
          debugVideoLog('[ConfigurableVideoSelector] Remote track detected, no cleanup needed');
          // 对于远程轨道，不需要清理任何资源
        } else {
          debugVideoLog('[ConfigurableVideoSelector] Complete cleanup for non-livekit track');
          // 完全清理所有资源，不保留任何状态
          const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
          if (currentCameraTrack?.track) {
            await localParticipant.unpublishTrack(currentCameraTrack.track);
          }
          if (currentTrack instanceof LocalVideoTrack) {
            currentTrack.stop();
          }
          clearSelectedTrack();
        }

        // 根据轨道类型决定处理策略
        if (trackToUse) {
          const option = getTrackById(trackToUse);

          if (option?.config.type === 'livekit') {
            debugVideoLog(
              '[ConfigurableVideoSelector] Handling livekit track directly:',
              trackToUse
            );

            // 对于LiveKit轨道，直接处理订阅，不调用switchToTrack
            const trackKey = option.config.livekitTrackName || option.config.id;
            const localTrackReference = getLocalTrackReference(trackKey);
            if (localTrackReference) {
              setSelectedTrack(trackToUse, localTrackReference);
              setIsTrackPreviewEnabled(true);
              return;
            }

            const remoteTrackInfo = getTrackByName(trackKey);

            if (remoteTrackInfo) {
              debugVideoLog('[ConfigurableVideoSelector] Subscribing to remote track:', trackKey);
              const subscribed = remoteTrackInfo.isSubscribed || (await subscribeToTrack(trackKey));

              if (subscribed) {
                const latestTrackInfo = getTrackByName(trackKey) ?? remoteTrackInfo;
                requestRemoteVideoHighQuality(latestTrackInfo.publication);
                if (!latestTrackInfo.track) {
                  debugVideoLog(
                    '[ConfigurableVideoSelector] Waiting for subscribed remote track media:',
                    trackKey
                  );
                  return;
                }
                debugVideoLog(
                  '[ConfigurableVideoSelector] Successfully subscribed to remote track:',
                  trackKey
                );

                const trackReference = createRemoteVideoTrackReference(room, latestTrackInfo);
                if (!trackReference) {
                  debugVideoLog(
                    '[ConfigurableVideoSelector] Remote participant is not ready yet:',
                    latestTrackInfo.participantIdentity
                  );
                  return;
                }

                // 直接设置预览轨道
                setSelectedTrack(trackToUse, trackReference);
                setIsTrackPreviewEnabled(true);

                debugVideoLog(
                  '[ConfigurableVideoSelector] Livekit track preview enabled:',
                  trackToUse
                );
              } else {
                debugVideoLog(
                  '[ConfigurableVideoSelector] Remote track subscription is still pending:',
                  trackKey
                );
              }
            } else {
              debugVideoLog('[ConfigurableVideoSelector] Remote track is not ready yet:', trackKey);
            }
          } else {
            debugVideoLog(
              '[ConfigurableVideoSelector] Using switchToTrack for non-livekit track:',
              trackToUse
            );

            // 对于非LiveKit轨道，使用switchToTrack
            await switchToTrack(trackToUse);

            debugVideoLog('[ConfigurableVideoSelector] switchToTrack completed, checking state...');
            debugVideoLog('[ConfigurableVideoSelector] Current state after switch:', {
              selectedTrackId,
              isTrackPreviewEnabled,
            });

            setIsTrackPreviewEnabled(true);
            onPressedChange?.(true);
          }
        }
      } else {
        debugVideoLog('[ConfigurableVideoSelector] Disabling track preview - COMPLETE CLEANUP');

        // 完全清理所有资源
        if (!isMediaExternallyControlled) {
          const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
          if (currentCameraTrack?.track) {
            await localParticipant.unpublishTrack(currentCameraTrack.track);
          }
        }
        if (currentTrack instanceof LocalVideoTrack && !isMediaExternallyControlled) {
          currentTrack.stop();
        }
        clearSelectedTrack();

        setIsTrackPreviewEnabled(false);
        didAutoEnableLivekitPreview.current = false;
        onPressedChange?.(false);
      }
    },
    [
      isTrackPreviewEnabled,
      selectedTrackId,
      defaultTrackId,
      getTrackById,
      getTrackByName,
      subscribeToTrack,
      switchToTrack,
      onPressedChange,
      localParticipant,
      currentTrack,
      setSelectedTrack,
      clearSelectedTrack,
      room,
      getLocalTrackReference,
      isMediaExternallyControlled,
    ]
  );

  // 统一的摄像头开关逻辑
  const handleToggleVideo = useCallback(
    async (enabled?: boolean) => {
      const shouldEnable = enabled !== undefined ? enabled : !effectivePressed;
      await onMediaEnabledChange?.(shouldEnable);

      if (shouldEnable) {
        didAutoEnableLivekitPreview.current = false;

        // 根据选择的轨道类型决定启用哪种预览
        const trackToUse = selectedTrackId || defaultTrackId;
        const option = trackToUse ? getTrackById(trackToUse) : null;

        if (option?.config.type === 'system') {
          await handleSystemCameraToggle(true);
        } else if (option?.config.type === 'livekit') {
          await handleTrackPreviewToggle(true);
        }
      } else {
        // 关闭时清理所有资源
        await cleanupAllResources();
        onPressedChange?.(false);
      }
    },
    [
      effectivePressed,
      selectedTrackId,
      defaultTrackId,
      getTrackById,
      handleSystemCameraToggle,
      handleTrackPreviewToggle,
      cleanupAllResources,
      onMediaEnabledChange,
      onPressedChange,
    ]
  );

  // 轨道切换逻辑
  const handleTrackChange = useCallback(
    async (trackId: string) => {
      debugVideoLog('[ConfigurableVideoSelector] Switching to track:', trackId);

      // 先清理所有现有资源
      await cleanupAllResources();

      // 设置新的轨道ID
      setSelectedTrackId(trackId);

      // 如果当前摄像头是开启状态，立即启用新轨道
      if (effectivePressed) {
        const option = getTrackById(trackId);
        if (option?.config.type === 'system') {
          await handleSystemCameraToggle(true);
        } else if (option?.config.type === 'livekit') {
          await handleTrackPreviewToggle(true, trackId);
        }
      }
    },
    [
      cleanupAllResources,
      effectivePressed,
      getTrackById,
      handleSystemCameraToggle,
      handleTrackPreviewToggle,
    ]
  );

  // LiveKit 输入轨道来自 room 中的 frontdesk participant，不需要用户再次手动打开本机摄像头。
  // 当默认远程轨道已经订阅成功时，自动把它选为预览轨道。
  useEffect(() => {
    if (
      didAutoEnableLivekitPreview.current ||
      disabled ||
      isLoading ||
      isTrackPreviewEnabled ||
      (isMediaExternallyControlled && !mediaEnabled)
    ) {
      return;
    }

    const trackToUse = selectedTrackId || defaultTrackId;
    if (!trackToUse) {
      return;
    }

    const option = getTrackById(trackToUse);
    if (option?.config.type !== 'livekit' || !option.available) {
      return;
    }

    const trackKey = option.config.livekitTrackName || option.config.id;
    const localTrackReference = getLocalTrackReference(trackKey);
    if (localTrackReference) {
      didAutoEnableLivekitPreview.current = true;
      void handleTrackPreviewToggle(true).catch((err) => {
        didAutoEnableLivekitPreview.current = false;
        onMediaDeviceError?.(err as Error);
      });
      return;
    }

    const remoteTrackInfo = getTrackByName(trackKey);
    if (!remoteTrackInfo) {
      return;
    }

    if (!remoteTrackInfo.track) {
      void subscribeToTrack(trackKey);
      return;
    }

    requestRemoteVideoHighQuality(remoteTrackInfo.publication);
    didAutoEnableLivekitPreview.current = true;
    void handleTrackPreviewToggle(true).catch((err) => {
      didAutoEnableLivekitPreview.current = false;
      onMediaDeviceError?.(err as Error);
    });
  }, [
    disabled,
    isLoading,
    isTrackPreviewEnabled,
    selectedTrackId,
    defaultTrackId,
    getTrackById,
    getTrackByName,
    getLocalTrackReference,
    subscribeToTrack,
    handleTrackPreviewToggle,
    onMediaDeviceError,
    isMediaExternallyControlled,
    mediaEnabled,
  ]);

  // 房间切换后，旧的远程 TrackReference 可能已经失效。
  // 一旦当前选中的 livekit 轨道在房间里消失，立即清掉旧引用，避免继续渲染已失效对象。
  useEffect(() => {
    if (!selectedTrackId) {
      return;
    }

    const option = getTrackById(selectedTrackId);
    if (option?.config.type !== 'livekit') {
      return;
    }

    const trackKey = option.config.livekitTrackName || option.config.id;
    const localTrackReference = getLocalTrackReference(trackKey);
    if (localTrackReference) {
      return;
    }

    const remoteTrackInfo = getTrackByName(trackKey);
    if (remoteTrackInfo) {
      return;
    }

    if (selectedContextTrackId === selectedTrackId) {
      debugVideoLog(
        '[ConfigurableVideoSelector] Selected livekit track disappeared, clearing stale track reference:',
        trackKey
      );
      clearSelectedTrack();
      setIsTrackPreviewEnabled(false);
      didAutoEnableLivekitPreview.current = false;
    }
  }, [
    selectedTrackId,
    selectedContextTrackId,
    getTrackById,
    getTrackByName,
    getLocalTrackReference,
    clearSelectedTrack,
  ]);

  // 获取可用的轨道选项
  const availableOptions = videoOptions.filter((opt) => opt.available);
  const hasLocalSystemCameraConfig = availableConfigs.some(
    (config) => config.enabled && config.type === 'system'
  );

  // 如果没有可用选项，显示基础切换按钮
  if (availableOptions.length === 0) {
    return (
      <TrackToggle
        size="icon"
        variant="primary"
        source={Track.Source.Camera}
        pressed={effectivePressed}
        pending={pending || mediaPending || isLoading}
        disabled={
          disabled ||
          mediaPending ||
          isLoading ||
          (!hasLocalSystemCameraConfig && !isMediaExternallyControlled)
        }
        onPressedChange={
          isMediaExternallyControlled
            ? handleToggleVideo
            : hasLocalSystemCameraConfig
              ? onPressedChange
              : undefined
        }
        className={className}
      />
    );
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-0">
        <TrackToggle
          size="icon"
          variant="primary"
          source={Track.Source.Camera}
          pressed={effectivePressed}
          pending={pending || mediaPending || isLoading}
          disabled={disabled || mediaPending || isLoading}
          onPressedChange={handleToggleVideo}
          className="peer/track group/track has-[~_div]:rounded-r-none has-[~_div]:pr-2 has-[~_div]:pl-3"
        />

        <hr className="bg-border peer-data-[state=off]/track:bg-destructive/20 relative z-10 -mr-px hidden h-4 w-px border-none has-[~_div]:block" />

        <div className="flex items-center">
          <Select
            value={selectedTrackId || ''}
            onValueChange={handleTrackChange}
            disabled={disabled || isLoading}
          >
            <SelectTrigger
              className={cn(
                'h-10 w-auto min-w-[140px] rounded-l-none border-none bg-transparent pl-2 text-sm',
                'peer-data-[state=off]/track:text-destructive',
                'hover:text-foreground focus:text-foreground',
                'hover:peer-data-[state=off]/track:text-foreground',
                'focus:peer-data-[state=off]/track:text-destructive',
                error && 'border-destructive'
              )}
            >
              <SelectValue placeholder="选择视频源...">
                {selectedTrackId &&
                  (() => {
                    const currentOption = availableOptions.find(
                      (opt) => opt.id === selectedTrackId
                    );
                    return currentOption ? (
                      <div className="flex items-center gap-2">
                        <VideoTrackOptionIcon icon={currentOption.icon} />
                        <span>{currentOption.label}</span>
                      </div>
                    ) : (
                      '选择视频源...'
                    );
                  })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <div className="flex items-center gap-2">
                    <VideoTrackOptionIcon icon={option.icon} />
                    <div className="flex flex-col">
                      <span>{option.label}</span>
                      {option.description && (
                        <span className="text-muted-foreground text-xs">{option.description}</span>
                      )}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 错误消息显示 */}
      {error && (
        <div className="text-destructive bg-destructive/10 border-destructive/20 flex items-center gap-2 rounded border px-2 py-1 text-xs">
          <WarningIcon size={14} weight="bold" />
          <span className="flex-1">{error}</span>
          <button
            onClick={clearError}
            className="text-destructive hover:text-destructive/80 ml-1"
            title="关闭错误消息"
          >
            <XIcon size={12} weight="bold" />
          </button>
        </div>
      )}
    </div>
  );
}

function isTrackReference(value: ConfigurableVideoTrackChange): value is TrackReference {
  return (
    !!value &&
    typeof value === 'object' &&
    'participant' in value &&
    'publication' in value &&
    'source' in value
  );
}

function isRemoteTrackPublication(
  publication: TrackReference['publication']
): publication is RemoteTrackPublication {
  return 'setVideoQuality' in publication;
}

function VideoTrackOptionIcon({ icon }: { icon: VideoTrackConfig['icon'] }) {
  if (icon === 'camera') {
    return <CameraIcon size={16} weight="bold" />;
  }
  if (icon === 'broadcast') {
    return <BroadcastIcon size={16} weight="bold" />;
  }
  return null;
}
