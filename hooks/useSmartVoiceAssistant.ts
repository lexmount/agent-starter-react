'use client';

import { useMemo } from 'react';
import { useRemoteParticipants, useVoiceAssistant } from '@livekit/components-react';
import { VideoTrackConfig } from '@/app-config';
import { useExcludedVideoTracks } from './useExcludedVideoTracks';

export interface UseSmartVoiceAssistantOptions {
  videoTrackConfigs?: VideoTrackConfig[];
}

/**
 * 智能语音助手 Hook，优先选择非配置的视频轨道作为 avatar
 */
export function useSmartVoiceAssistant({
  videoTrackConfigs = [],
}: UseSmartVoiceAssistantOptions = {}) {
  const voiceAssistant = useVoiceAssistant();
  const remoteParticipants = useRemoteParticipants();
  const { shouldExcludeTrack } = useExcludedVideoTracks({ videoTrackConfigs });

  // 智能选择 avatar 视频轨道
  const smartVideoTrack = useMemo(() => {
    // 如果原始 voiceAssistant 有视频轨道且不在排除列表中，使用它
    if (voiceAssistant.videoTrack) {
      const trackName = voiceAssistant.videoTrack.publication.trackName || 
                       voiceAssistant.videoTrack.publication.trackSid;
      
      if (!shouldExcludeTrack(trackName)) {
        console.log(`[useSmartVoiceAssistant] Using original voice assistant track: ${trackName}`);
        return voiceAssistant.videoTrack;
      } else {
        console.log(`[useSmartVoiceAssistant] Original track excluded: ${trackName}`);
      }
    }

    // 如果原始轨道被排除，寻找其他合适的轨道
    for (const participant of remoteParticipants) {
      if (!participant.isAgent) continue;
      
      for (const [, publication] of participant.videoTrackPublications) {
        if (!publication.isSubscribed || !publication.track) continue;
        
        const trackName = publication.trackName || publication.trackSid;
        
        // 跳过配置中的轨道
        if (shouldExcludeTrack(trackName)) {
          console.log(`[useSmartVoiceAssistant] Skipping excluded track: ${trackName}`);
          continue;
        }
        
        // 找到合适的轨道
        const trackRef = {
          participant,
          publication,
          source: publication.source,
        };
        
        console.log(`[useSmartVoiceAssistant] Found alternative avatar track: ${trackName} from ${participant.identity}`);
        return trackRef;
      }
    }

    console.log(`[useSmartVoiceAssistant] No suitable avatar track found`);
    return undefined;
  }, [voiceAssistant.videoTrack, remoteParticipants, shouldExcludeTrack]);

  return {
    ...voiceAssistant,
    videoTrack: smartVideoTrack,
  };
}
