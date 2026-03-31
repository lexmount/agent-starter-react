'use client';

import { RoomAudioRenderer } from '@livekit/components-react';
import { useAudioTrackFilter } from '@/hooks/useAudioTrackFilter';

interface FilteredAudioRendererProps {
  excludeTrackNames?: string[];
  volume?: number;
}

/**
 * 使用 LiveKit 官方播放器渲染房间音频，并在渲染前取消订阅被排除的轨道。
 */
export function FilteredAudioRenderer({ 
  excludeTrackNames = [], 
  volume = 1.0 
}: FilteredAudioRendererProps) {
  useAudioTrackFilter({
    excludeTrackNames,
    autoUnsubscribe: true,
  });

  return <RoomAudioRenderer volume={volume} />;
}
