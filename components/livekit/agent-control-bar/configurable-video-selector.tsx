'use client';

import { useCallback, useState } from 'react';
import { LocalVideoTrack, Track } from 'livekit-client';
import { useLocalParticipant, useRoomContext, type TrackReference } from '@livekit/components-react';
import { VideoTrackConfig } from '@/app-config';
import { TrackToggle } from '@/components/livekit/agent-control-bar/track-toggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/livekit/select';
import { VideoTrackOption, useConfigurableVideoTracks } from '@/hooks/useConfigurableVideoTracks';
import { useSelectedVideoTrack } from '@/hooks/useSelectedVideoTrack';
import { useRemoteVideoTracks } from '@/hooks/useRemoteVideoTracks';
import { cn } from '@/lib/utils';

interface ConfigurableVideoSelectorProps {
  availableConfigs: VideoTrackConfig[];
  defaultTrackId?: string;
  existingLivekitTracks?: Map<string, LocalVideoTrack>;
  pressed?: boolean;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
  onPressedChange?: (pressed: boolean) => void;
  onMediaDeviceError?: (error: Error) => void;
  onTrackChange?: (trackId: string, track: LocalVideoTrack | null) => void;
}

export function ConfigurableVideoSelector({
  availableConfigs,
  defaultTrackId,
  existingLivekitTracks,
  pressed,
  pending,
  disabled,
  className,
  onPressedChange,
  onMediaDeviceError,
  onTrackChange,
}: ConfigurableVideoSelectorProps) {
  const { localParticipant } = useLocalParticipant();
  const { setSelectedTrack } = useSelectedVideoTrack();
  const room = useRoomContext();
  const { getTrackByName, subscribeToTrack } = useRemoteVideoTracks();
  
  // 分离的状态管理
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(defaultTrackId || null);
  const [isSystemCameraEnabled, setIsSystemCameraEnabled] = useState(false);
  const [isTrackPreviewEnabled, setIsTrackPreviewEnabled] = useState(false);

  const {
    videoOptions,
    currentTrackId,
    currentTrack,
    isLoading,
    error,
    switchToTrack,
    getTrackById,
    clearError,
  } = useConfigurableVideoTracks({
    availableConfigs,
    defaultTrackId,
    existingLivekitTracks,
    onTrackChange: async (trackId, trackOrTrackRef) => {
      console.log('[ConfigurableVideoSelector] Track changed:', trackId, trackOrTrackRef);
      console.log('[ConfigurableVideoSelector] TrackOrTrackRef type:', typeof trackOrTrackRef);
      console.log('[ConfigurableVideoSelector] TrackOrTrackRef keys:', trackOrTrackRef ? Object.keys(trackOrTrackRef) : 'null');
      
      const option = getTrackById(trackId);
      if (!option) {
        console.log('[ConfigurableVideoSelector] No option found for trackId:', trackId);
        return;
      }
      
      console.log('[ConfigurableVideoSelector] Processing track:', {
        trackId,
        type: option.config.type,
        label: option.label,
      });
      
      try {
        if (option.config.type === 'system' && trackOrTrackRef && 'kind' in trackOrTrackRef) {
          // 系统摄像头：发布本地轨道
          console.log('[ConfigurableVideoSelector] Enabling system camera');
          
          const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
          if (currentCameraTrack) {
            await localParticipant.unpublishTrack(currentCameraTrack.track!);
          }
          
          await localParticipant.publishTrack(trackOrTrackRef as LocalVideoTrack, {
            source: Track.Source.Camera,
            name: trackId,
          });
          
          // 设置预览轨道
          const trackRef: TrackReference = {
            participant: localParticipant,
            source: Track.Source.Camera,
            publication: localParticipant.getTrackPublication(Track.Source.Camera)!,
          };
          setSelectedTrack(trackId, trackRef);
          setIsSystemCameraEnabled(true);
          
        } else if (option.config.type === 'livekit' && trackOrTrackRef) {
          // 远程轨道：直接使用远程轨道，不取消发布本地轨道
          console.log('[ConfigurableVideoSelector] Processing livekit track:', trackId);
          console.log('[ConfigurableVideoSelector] TrackOrTrackRef details:', {
            hasParticipant: 'participant' in trackOrTrackRef,
            hasPublication: 'publication' in trackOrTrackRef,
            hasSource: 'source' in trackOrTrackRef,
            keys: Object.keys(trackOrTrackRef),
          });
          
          console.log('[ConfigurableVideoSelector] Setting selected track for livekit:', trackId);
          setSelectedTrack(trackId, trackOrTrackRef as unknown as TrackReference);
          setIsTrackPreviewEnabled(true);
          
          console.log('[ConfigurableVideoSelector] Livekit track enabled, selectedTrack set:', trackId);
        } else {
          console.log('[ConfigurableVideoSelector] Track type not handled:', option.config.type);
        }
        
        onTrackChange?.(trackId, trackOrTrackRef as LocalVideoTrack | null);
      } catch (err) {
        console.error('[ConfigurableVideoSelector] Failed to handle track change:', err);
        onMediaDeviceError?.(err as Error);
      }
    },
    onError: onMediaDeviceError,
  });

  // 系统摄像头开关逻辑
  const handleSystemCameraToggle = useCallback(
    async (enabled?: boolean) => {
      const shouldEnable = enabled !== undefined ? enabled : !isSystemCameraEnabled;
      
      if (shouldEnable) {
        console.log('[ConfigurableVideoSelector] Enabling system camera from scratch');
        
        // 先清理所有现有状态
        await cleanupAllResources();
        
        // 从头开始启用系统摄像头
        const systemTrackId = 'system_camera_default';
        setSelectedTrackId(systemTrackId);
        await switchToTrack(systemTrackId);
        
        setIsSystemCameraEnabled(true);
        onPressedChange?.(true);
      } else {
        console.log('[ConfigurableVideoSelector] Disabling system camera');
        
        // 完全清理系统摄像头资源
        await cleanupSystemCameraResources();
        
        setIsSystemCameraEnabled(false);
        onPressedChange?.(false);
      }
    },
    [isSystemCameraEnabled, switchToTrack, onPressedChange]
  );

  // 指定轨道预览开关逻辑
  const handleTrackPreviewToggle = useCallback(
    async (enabled?: boolean) => {
      const shouldEnable = enabled !== undefined ? enabled : !isTrackPreviewEnabled;
      
      if (shouldEnable) {
        console.log('[ConfigurableVideoSelector] Enabling track preview - FRESH START');
        
        // 根据轨道类型决定清理策略
        const option = selectedTrackId ? getTrackById(selectedTrackId) : null;
        if (option?.config.type === 'livekit') {
          console.log('[ConfigurableVideoSelector] Remote track detected, no cleanup needed');
          // 对于远程轨道，不需要清理任何资源
        } else {
          console.log('[ConfigurableVideoSelector] Complete cleanup for non-livekit track');
          // 完全清理所有资源，不保留任何状态
          const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
          if (currentCameraTrack) {
            await localParticipant.unpublishTrack(currentCameraTrack.track!);
          }
          if (currentTrack) {
            currentTrack.stop();
          }
          setSelectedTrack('', null);
        }
        
        // 根据轨道类型决定处理策略
        const trackToUse = selectedTrackId || defaultTrackId;
        if (trackToUse) {
          const option = getTrackById(trackToUse);
          
          if (option?.config.type === 'livekit') {
            console.log('[ConfigurableVideoSelector] Handling livekit track directly:', trackToUse);
            
            // 对于LiveKit轨道，直接处理订阅，不调用switchToTrack
            const trackKey = option.config.livekitTrackName || option.config.id;
            const remoteTrackInfo = getTrackByName(trackKey);
            
            if (remoteTrackInfo) {
              console.log('[ConfigurableVideoSelector] Subscribing to remote track:', trackKey);
              const subscribed = await subscribeToTrack(trackKey);
              
              if (subscribed && remoteTrackInfo.track) {
                console.log('[ConfigurableVideoSelector] Successfully subscribed to remote track:', trackKey);
                
                // 创建 TrackReference
                const participant = room?.remoteParticipants.get(remoteTrackInfo.participantIdentity) || null;
                const trackReference = {
                  participant: participant,
                  publication: remoteTrackInfo.publication,
                  source: remoteTrackInfo.publication.source,
                };
                
                // 直接设置预览轨道
                setSelectedTrack(trackToUse, trackReference as unknown as TrackReference);
                setIsTrackPreviewEnabled(true);
                onPressedChange?.(true);
                
                console.log('[ConfigurableVideoSelector] Livekit track preview enabled:', trackToUse);
              } else {
                console.error('[ConfigurableVideoSelector] Failed to subscribe to remote track:', trackKey);
              }
            } else {
              console.error('[ConfigurableVideoSelector] Remote track not found:', trackKey);
            }
          } else {
            console.log('[ConfigurableVideoSelector] Using switchToTrack for non-livekit track:', trackToUse);
            
            // 对于非LiveKit轨道，使用switchToTrack
            await switchToTrack(trackToUse);
            
            console.log('[ConfigurableVideoSelector] switchToTrack completed, checking state...');
            console.log('[ConfigurableVideoSelector] Current state after switch:', {
              currentTrackId,
              selectedTrackId,
              isTrackPreviewEnabled,
            });
            
            setIsTrackPreviewEnabled(true);
            onPressedChange?.(true);
          }
        }
      } else {
        console.log('[ConfigurableVideoSelector] Disabling track preview - COMPLETE CLEANUP');
        
        // 完全清理所有资源
        const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
        if (currentCameraTrack) {
          await localParticipant.unpublishTrack(currentCameraTrack.track!);
        }
        if (currentTrack) {
          currentTrack.stop();
        }
        setSelectedTrack('', null);
        
        setIsTrackPreviewEnabled(false);
        onPressedChange?.(false);
      }
    },
    [isTrackPreviewEnabled, selectedTrackId, defaultTrackId, switchToTrack, onPressedChange, localParticipant, currentTrack, setSelectedTrack]
  );

  // 统一的摄像头开关逻辑
  const handleToggleVideo = useCallback(
    async (enabled?: boolean) => {
      const shouldEnable = enabled !== undefined ? enabled : !pressed;
      
      if (shouldEnable) {
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
    [pressed, selectedTrackId, defaultTrackId, getTrackById, handleSystemCameraToggle, handleTrackPreviewToggle, onPressedChange]
  );

  // 清理系统摄像头资源
  const cleanupSystemCameraResources = useCallback(async () => {
    try {
      console.log('[ConfigurableVideoSelector] Cleaning up system camera resources');
      
      const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
      if (currentCameraTrack) {
        await localParticipant.unpublishTrack(currentCameraTrack.track!);
      }
      
      if (currentTrack) {
        currentTrack.stop();
      }
      
      setSelectedTrack('', null);
      setIsSystemCameraEnabled(false);
    } catch (err) {
      console.error('[ConfigurableVideoSelector] Failed to cleanup system camera:', err);
    }
  }, [localParticipant, currentTrack, setSelectedTrack]);

  // 清理轨道预览资源
  const cleanupTrackPreviewResources = useCallback(async () => {
    try {
      console.log('[ConfigurableVideoSelector] Cleaning up track preview resources');
      
      // 只取消发布本地轨道，不破坏远程轨道订阅
      const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
      if (currentCameraTrack) {
        await localParticipant.unpublishTrack(currentCameraTrack.track!);
      }
      
      // 只清除预览状态，保持轨道选择
      setSelectedTrack('', null);
      setIsTrackPreviewEnabled(false);
      
      console.log('[ConfigurableVideoSelector] Track preview cleaned, but keeping track selection:', selectedTrackId);
    } catch (err) {
      console.error('[ConfigurableVideoSelector] Failed to cleanup track preview:', err);
    }
  }, [localParticipant, setSelectedTrack, selectedTrackId]);

  // 清理所有资源
  const cleanupAllResources = useCallback(async () => {
    console.log('[ConfigurableVideoSelector] Complete cleanup - no state dependency');
    
    // 完全清理所有资源，不区分轨道类型
    const currentCameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
    if (currentCameraTrack) {
      await localParticipant.unpublishTrack(currentCameraTrack.track!);
    }
    if (currentTrack) {
      currentTrack.stop();
    }
    setSelectedTrack('', null);
    setIsSystemCameraEnabled(false);
    setIsTrackPreviewEnabled(false);
  }, [localParticipant, currentTrack, setSelectedTrack]);

  // 轨道切换逻辑
  const handleTrackChange = useCallback(
    async (trackId: string) => {
      console.log('[ConfigurableVideoSelector] Switching to track:', trackId);
      
      // 先清理所有现有资源
      await cleanupAllResources();
      
      // 设置新的轨道ID
      setSelectedTrackId(trackId);
      
      // 如果当前摄像头是开启状态，立即启用新轨道
      if (pressed) {
        const option = getTrackById(trackId);
        if (option?.config.type === 'system') {
          await handleSystemCameraToggle(true);
        } else if (option?.config.type === 'livekit') {
          await handleTrackPreviewToggle(true);
        }
      }
    },
    [cleanupAllResources, pressed, getTrackById, handleSystemCameraToggle, handleTrackPreviewToggle]
  );

  // 获取可用的轨道选项
  const availableOptions = videoOptions.filter((opt) => opt.available);

  // 如果没有可用选项，显示基础切换按钮
  if (availableOptions.length === 0) {
    return (
      <TrackToggle
        size="icon"
        variant="primary"
        source={Track.Source.Camera}
        pressed={pressed}
        pending={pending || isLoading}
        disabled={disabled || isLoading}
        onPressedChange={onPressedChange}
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
          pressed={pressed}
          pending={pending || isLoading}
          disabled={disabled || isLoading}
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
                    const currentOption = availableOptions.find((opt) => opt.id === selectedTrackId);
                    return currentOption ? (
                      <div className="flex items-center gap-2">
                        {currentOption.icon && <span>{currentOption.icon}</span>}
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
                    {option.icon && <span>{option.icon}</span>}
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
          <span>⚠️</span>
          <span className="flex-1">{error}</span>
          <button
            onClick={clearError}
            className="text-destructive hover:text-destructive/80 ml-1"
            title="关闭错误消息"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}