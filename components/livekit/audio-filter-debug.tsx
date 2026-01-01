'use client';

import React from 'react';
import { useAudioTrackFilter } from '@/hooks/useAudioTrackFilter';
import { useRemoteParticipants } from '@livekit/components-react';

interface AudioFilterDebugProps {
  excludeTrackNames?: string[];
  show?: boolean;
}

/**
 * 音频过滤调试组件
 * 显示当前房间中的所有音频轨道和过滤状态
 */
export function AudioFilterDebug({ excludeTrackNames = [], show = false }: AudioFilterDebugProps) {
  const participants = useRemoteParticipants();
  const { shouldExcludeTrack, getFilteredTracks, unsubscribeTrack, subscribeTrack } = useAudioTrackFilter({
    excludeTrackNames,
    autoUnsubscribe: false, // 调试时不自动取消订阅
  });

  const filteredTracks = getFilteredTracks();

  const handleToggleSubscription = async (trackSid: string, isSubscribed: boolean) => {
    if (isSubscribed) {
      await unsubscribeTrack(trackSid);
    } else {
      await subscribeTrack(trackSid);
    }
  };

  if (!show) {
    return null; // 不显示调试信息
  }

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm bg-black/80 text-white p-4 rounded-lg text-xs">
      <h3 className="font-bold mb-2">音频轨道调试</h3>
      
      <div className="mb-3">
        <div className="text-yellow-400">排除规则: {excludeTrackNames.join(', ') || '无'}</div>
      </div>

      <div className="space-y-2">
        <div className="font-semibold">所有参与者音频轨道:</div>
        {participants.map(participant => (
          <div key={participant.identity} className="border-l-2 border-blue-500 pl-2">
            <div className="text-blue-300">{participant.identity}</div>
            {Array.from(participant.audioTrackPublications.values()).map(publication => {
              const isExcluded = shouldExcludeTrack(publication);
              const trackName = publication.trackName || publication.trackSid;
              
              return (
                <div 
                  key={publication.trackSid} 
                  className={`ml-2 p-1 rounded ${isExcluded ? 'bg-red-900/50' : 'bg-green-900/50'}`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className={isExcluded ? 'text-red-300' : 'text-green-300'}>
                        {trackName}
                      </div>
                      <div className="text-gray-400 text-xs">
                        SID: {publication.trackSid}
                      </div>
                      <div className="text-gray-400 text-xs">
                        订阅: {publication.isSubscribed ? '是' : '否'} | 
                        过滤: {isExcluded ? '是' : '否'}
                      </div>
                    </div>
                    <button
                      onClick={() => handleToggleSubscription(publication.trackSid, publication.isSubscribed)}
                      className="ml-2 px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs"
                    >
                      {publication.isSubscribed ? '取消' : '订阅'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {filteredTracks.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-600">
          <div className="font-semibold text-red-300">被过滤的轨道:</div>
          {filteredTracks.map(track => (
            <div key={`${track.participantIdentity}-${track.trackSid}`} className="text-red-200 text-xs">
              {track.participantIdentity}: {track.trackName}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
