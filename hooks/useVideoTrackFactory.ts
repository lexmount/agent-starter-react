import { useCallback, useRef } from 'react';
import { LocalVideoTrack, createLocalVideoTrack } from 'livekit-client';
import { VideoTrackConfig } from '@/app-config';

export interface UseVideoTrackFactoryReturn {
  createTrackFromConfig: (
    config: VideoTrackConfig,
    existingTrack?: LocalVideoTrack
  ) => Promise<LocalVideoTrack | null>;
  createSystemCameraTrack: (
    deviceId?: string,
    config?: VideoTrackConfig
  ) => Promise<LocalVideoTrack | null>;
  createLivekitTrack: (
    config: VideoTrackConfig,
    existingTrack?: LocalVideoTrack
  ) => Promise<LocalVideoTrack | null>;
}

export function useVideoTrackFactory(): UseVideoTrackFactoryReturn {
  // 根据配置创建视频轨道
  const createTrackFromConfig = useCallback(
    async (
      config: VideoTrackConfig,
      existingTrack?: LocalVideoTrack
    ): Promise<LocalVideoTrack | null> => {
      if (!config.enabled) {
        return null;
      }

      try {
        switch (config.type) {
          case 'system':
            return await createSystemCameraTrack(undefined, config);

          case 'livekit':
            return await createLivekitTrack(config, existingTrack);

          default:
            console.warn(`Unknown video track type: ${config.type}`);
        }
      } catch (error) {
        console.error(`Failed to create video track for config ${config.id}:`, error);
      }

      return null;
    },
    []
  );

  // 创建系统摄像头轨道
  const createSystemCameraTrack = useCallback(
    async (deviceId?: string, config?: VideoTrackConfig): Promise<LocalVideoTrack | null> => {
      try {
        const options: any = {};

        if (deviceId) {
          options.deviceId = deviceId;
        } else {
          options.facingMode = 'user';
        }

        const track = await createLocalVideoTrack(options);
        return track;
      } catch (error) {
        console.error('Failed to create system camera track:', error);
        return null;
      }
    },
    []
  );

  // 创建LiveKit轨道（使用现有轨道或克隆）
  const createLivekitTrack = useCallback(
    async (
      config: VideoTrackConfig,
      existingTrack?: LocalVideoTrack
    ): Promise<LocalVideoTrack | null> => {
      try {
        if (existingTrack) {
          // 如果提供了现有轨道，检查是否匹配配置
          const trackName = (existingTrack as any).name;
          const trackSource = existingTrack.source;

          if (config.livekitTrackName && trackName !== config.livekitTrackName) {
            console.warn(
              `Track name mismatch: expected ${config.livekitTrackName}, got ${trackName}`
            );
          }

          // 返回现有轨道
          return existingTrack;
        }

        // 如果没有提供现有轨道，尝试创建一个新的轨道
        // 这里可以根据需要实现轨道查找逻辑
        console.warn('No existing LiveKit track provided and track creation not implemented');
        return null;
      } catch (error) {
        console.error('Failed to create LiveKit track:', error);
        return null;
      }
    },
    []
  );

  return {
    createTrackFromConfig,
    createSystemCameraTrack,
    createLivekitTrack,
  };
}
