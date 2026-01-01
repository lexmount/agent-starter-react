'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LocalVideoTrack } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { VideoTrackConfig } from '@/app-config';
import { useRemoteVideoTracks } from './useRemoteVideoTracks';
import { useVideoTrackFactory } from './useVideoTrackFactory';

export interface VideoTrackOption {
  id: string;
  label: string;
  type: VideoTrackConfig['type'];
  icon?: string;
  description?: string;
  config: VideoTrackConfig;
  available: boolean;
  track?: LocalVideoTrack;
  trackReference?: any;
}

export interface UseConfigurableVideoTracksOptions {
  availableConfigs: VideoTrackConfig[];
  defaultTrackId?: string;
  existingLivekitTracks?: Map<string, LocalVideoTrack>; // 现有的LiveKit轨道
  onTrackChange?: (trackId: string, track: LocalVideoTrack | null) => void;
  onError?: (error: Error) => void;
}

export interface UseConfigurableVideoTracksReturn {
  videoOptions: VideoTrackOption[];
  currentTrackId: string | null;
  currentTrack: LocalVideoTrack | null;
  isLoading: boolean;
  error: string | null;
  switchToTrack: (trackId: string) => Promise<void>;
  getTrackById: (trackId: string) => VideoTrackOption | undefined;
  clearError: () => void;
}

export function useConfigurableVideoTracks({
  availableConfigs,
  defaultTrackId,
  existingLivekitTracks,
  onTrackChange,
  onError,
}: UseConfigurableVideoTracksOptions): UseConfigurableVideoTracksReturn {
  const room = useRoomContext();
  const [videoOptions, setVideoOptions] = useState<VideoTrackOption[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [currentTrack, setCurrentTrack] = useState<LocalVideoTrack | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackFactory = useVideoTrackFactory();
  const { remoteVideoTracks, subscribeToTrack, getTrackByName } = useRemoteVideoTracks();

  // 初始化视频选项
  const initializeVideoOptions = useCallback(async () => {
    setIsLoading(true);

    const options: VideoTrackOption[] = [];

    for (const config of availableConfigs) {
      if (!config.enabled) continue;

      const option: VideoTrackOption = {
        id: config.id,
        label: config.label,
        type: config.type,
        icon: config.icon,
        description: config.description,
        config,
        available: false,
        track: undefined,
      };

      // 检查轨道是否可用
      try {
        if (config.type === 'system') {
          // 检查系统摄像头
          const devices = await navigator.mediaDevices.enumerateDevices();
          const hasCamera = devices.some((device) => device.kind === 'videoinput');
          option.available = hasCamera;
        } else if (config.type === 'livekit') {
          // 检查LiveKit轨道是否存在
          const trackKey = config.livekitTrackName || config.id;

          // 优先检查 existingLivekitTracks（用于本地轨道）
          if (existingLivekitTracks && existingLivekitTracks.has(trackKey)) {
            option.available = true;
          } else {
            // 检查远程轨道
            const remoteTrackInfo = getTrackByName(trackKey);
            option.available = !!remoteTrackInfo;
            console.log(
              `[useConfigurableVideoTracks] LiveKit track "${trackKey}" ${option.available ? 'found' : 'not found'} in remote tracks`
            );
          }
        } else {
          option.available = false;
        }
      } catch (error) {
        console.warn(`Failed to check availability for track ${config.id}:`, error);
        option.available = false;
      }

      options.push(option);
    }

    setVideoOptions(options);
    setIsLoading(false);

    // 设置默认选中的轨道（但不连接）- 只在初始化时设置
    if (defaultTrackId && !currentTrackId) {
      const defaultOption = options.find((opt) => opt.id === defaultTrackId);
      if (defaultOption) {
        setCurrentTrackId(defaultTrackId);
        console.log(`Default track selected: ${defaultOption.label} (not connected yet)`);
      } else {
        // 如果默认轨道不存在，选择第一个可用的轨道
        const firstAvailable = options.find((opt) => opt.available);
        if (firstAvailable) {
          setCurrentTrackId(firstAvailable.id);
          console.log(`Fallback track selected: ${firstAvailable.label} (not connected yet)`);
        }
      }
    }
  }, [availableConfigs, defaultTrackId, getTrackByName, currentTrackId]);

  // 切换到指定轨道
  const switchToTrack = useCallback(
    async (trackId: string) => {
      console.log('[useConfigurableVideoTracks] switchToTrack called:', trackId);
      console.log('[useConfigurableVideoTracks] Current state:', {
        currentTrackId,
        videoOptionsCount: videoOptions.length,
        availableOptions: videoOptions.filter(opt => opt.available).map(opt => opt.id),
      });
      
      setIsLoading(true);
      setError(null); // 清除之前的错误

      try {
        const option = videoOptions.find((opt) => opt.id === trackId);
        if (!option) {
          const errorMsg = `视频轨道 "${trackId}" 不存在`;
          setError(errorMsg);
          console.error(errorMsg);
          return;
        }

        console.log('[useConfigurableVideoTracks] Found option:', {
          id: option.id,
          label: option.label,
          type: option.config.type,
          available: option.available,
        });

        // 先设置当前选中的轨道ID（即使连接可能失败）
        setCurrentTrackId(trackId);
        console.log('[useConfigurableVideoTracks] Set currentTrackId to:', trackId);

        // 停止当前轨道
        if (currentTrack) {
          currentTrack.stop();
          setCurrentTrack(null);
        }

        let existingTrack: LocalVideoTrack | undefined;

        // 处理不同类型的轨道
        if (option.config.type === 'livekit') {
          const trackKey = option.config.livekitTrackName || option.config.id;

          // 优先使用本地轨道
          existingTrack = existingLivekitTracks?.get(trackKey);

          if (!existingTrack) {
            // 尝试订阅远程轨道
            const remoteTrackInfo = getTrackByName(trackKey);
            if (remoteTrackInfo) {
              console.log(
                `[useConfigurableVideoTracks] Attempting to subscribe to remote track: ${trackKey}`
              );
              const subscribed = await subscribeToTrack(trackKey);
              if (subscribed && remoteTrackInfo.track) {
                console.log(
                  `[useConfigurableVideoTracks] Successfully subscribed to remote track: ${trackKey}`
                );

                // 创建一个 TrackReference 对象来兼容 VideoTrack 组件
                // 需要找到正确的参与者对象
                const participant = room?.remoteParticipants.get(remoteTrackInfo.participantIdentity) || null;
                const trackReference = {
                  participant: participant,
                  publication: remoteTrackInfo.publication,
                  source: remoteTrackInfo.publication.source,
                };

                // 设置当前轨道（用于状态管理）
                setCurrentTrack(remoteTrackInfo.track as any);

                // 更新选项中的轨道引用
                setVideoOptions((prev) =>
                  prev.map((opt) =>
                    opt.id === trackId
                      ? { ...opt, track: remoteTrackInfo.track as any, trackReference }
                      : { ...opt, track: opt.id === currentTrackId ? undefined : opt.track }
                  )
                );

                console.log(`Successfully connected to remote track: ${option.label}`);
                
                // 设置当前轨道ID
                setCurrentTrackId(trackId);
                
                // 对于远程轨道，传递 trackReference 给 onTrackChange
                onTrackChange?.(trackId, trackReference as any);
                return; // 直接返回，不需要继续创建轨道
              } else {
                const errorMsg = `无法订阅LiveKit轨道 "${option.label}"，请检查轨道状态`;
                setError(errorMsg);
                console.error(errorMsg);
                return;
              }
            } else {
              const errorMsg = `LiveKit轨道 "${option.label}" 未找到，请确保轨道已正确发布`;
              setError(errorMsg);
              console.error(errorMsg);
              // 不要回退到其他轨道，保持当前选择但不连接
              return;
            }
          }
        }

        // 对于系统摄像头，检查可用性
        if (option.config.type === 'system' && !option.available) {
          const errorMsg = `系统摄像头 "${option.label}" 当前不可用，请检查设备连接或权限`;
          setError(errorMsg);
          console.error(errorMsg);
          return;
        }

        const newTrack = await trackFactory.createTrackFromConfig(option.config, existingTrack);

        if (newTrack) {
          setCurrentTrack(newTrack);
          
          // 设置当前轨道ID
          setCurrentTrackId(trackId);

          // 更新选项中的轨道引用
          setVideoOptions((prev) =>
            prev.map((opt) =>
              opt.id === trackId
                ? { ...opt, track: newTrack }
                : { ...opt, track: opt.id === currentTrackId ? undefined : opt.track }
            )
          );

          console.log(`Successfully connected to track: ${option.label}`);
          onTrackChange?.(trackId, newTrack);
        } else {
          const errorMsg = `无法创建视频轨道 "${option.label}"，请检查设备或权限`;
          setError(errorMsg);
          console.error(errorMsg);
          // 保持选择但不连接轨道
        }
      } catch (error) {
        const errorMsg = `连接视频轨道时发生错误: ${(error as Error).message}`;
        setError(errorMsg);
        console.error('Error connecting video track:', error);
        // 保持选择但不连接轨道
        onError?.(error as Error);
      } finally {
        setIsLoading(false);
      }
    },
    [
      videoOptions,
      currentTrack,
      currentTrackId,
      trackFactory,
      existingLivekitTracks,
      onTrackChange,
      onError,
      room,
      subscribeToTrack,
      getTrackByName,
    ]
  );

  // 刷新轨道列表
  // 移除刷新功能 - 视频轨道列表在初始化时确定

  // 根据ID获取轨道选项
  const getTrackById = useCallback(
    (trackId: string) => {
      return videoOptions.find((opt) => opt.id === trackId);
    },
    [videoOptions]
  );

  // 清除错误
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // 初始化
  useEffect(() => {
    initializeVideoOptions();
  }, [initializeVideoOptions]);

  // 监听远程轨道变化
  useEffect(() => {
    if (remoteVideoTracks.size > 0) {
      console.log('[useConfigurableVideoTracks] Remote tracks updated, refreshing availability');
      initializeVideoOptions();
    }
  }, [remoteVideoTracks, initializeVideoOptions]);

  return {
    videoOptions,
    currentTrackId,
    currentTrack,
    isLoading,
    error,
    switchToTrack,
    getTrackById,
    clearError,
  };
}