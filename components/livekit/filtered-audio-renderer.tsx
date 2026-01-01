'use client';

import React, { useEffect, useRef } from 'react';
import { useRoomContext, useRemoteParticipants } from '@livekit/components-react';
import { Track, TrackPublication } from 'livekit-client';

interface FilteredAudioRendererProps {
  excludeTrackNames?: string[];
  volume?: number;
}

/**
 * 自定义音频渲染器，支持按轨道名称过滤音频
 * 可以排除指定名称的音频轨道不进行播放
 */
export function FilteredAudioRenderer({ 
  excludeTrackNames = [], 
  volume = 1.0 
}: FilteredAudioRendererProps) {
  const room = useRoomContext();
  const participants = useRemoteParticipants();
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    if (!room) return;

    const audioElements = audioElementsRef.current;

    // 清理函数
    const cleanup = () => {
      audioElements.forEach((element) => {
        element.pause();
        element.srcObject = null;
        element.remove();
      });
      audioElements.clear();
    };

    // 处理音频轨道订阅
    const handleAudioTrack = (publication: TrackPublication, participantIdentity: string) => {
      if (publication.kind !== Track.Kind.Audio || !publication.track) {
        return;
      }

      const trackName = publication.trackName || publication.trackSid;
      const elementKey = `${participantIdentity}-${trackName}`;

      // 检查是否应该排除此轨道
      const shouldExclude = excludeTrackNames.some(excludeName => 
        trackName.includes(excludeName) || 
        trackName === excludeName ||
        publication.trackSid === excludeName
      );

      if (shouldExclude) {
        console.log(`[FilteredAudioRenderer] 排除音频轨道: ${trackName} (参与者: ${participantIdentity})`);
        
        // 如果之前有播放这个轨道，现在停止
        const existingElement = audioElements.get(elementKey);
        if (existingElement) {
          existingElement.pause();
          existingElement.srcObject = null;
          existingElement.remove();
          audioElements.delete(elementKey);
        }
        return;
      }

      // 创建或更新音频元素
      let audioElement = audioElements.get(elementKey);
      if (!audioElement) {
        audioElement = document.createElement('audio');
        audioElement.autoplay = true;
        audioElement.setAttribute('playsinline', 'true');
        audioElement.volume = volume;
        document.body.appendChild(audioElement);
        audioElements.set(elementKey, audioElement);
        
        console.log(`[FilteredAudioRenderer] 创建音频元素: ${trackName} (参与者: ${participantIdentity})`);
      }

      // 设置音频流
      const mediaStream = new MediaStream([publication.track.mediaStreamTrack]);
      audioElement.srcObject = mediaStream;
      audioElement.volume = volume;

      console.log(`[FilteredAudioRenderer] 播放音频轨道: ${trackName} (参与者: ${participantIdentity})`);
    };

    // 处理轨道取消订阅
    const handleTrackUnsubscribed = (publication: TrackPublication, participantIdentity: string) => {
      if (publication.kind !== Track.Kind.Audio) return;

      const trackName = publication.trackName || publication.trackSid;
      const elementKey = `${participantIdentity}-${trackName}`;
      
      const audioElement = audioElements.get(elementKey);
      if (audioElement) {
        audioElement.pause();
        audioElement.srcObject = null;
        audioElement.remove();
        audioElements.delete(elementKey);
        
        console.log(`[FilteredAudioRenderer] 停止音频轨道: ${trackName} (参与者: ${participantIdentity})`);
      }
    };

    // 监听现有参与者的轨道
    participants.forEach(participant => {
      participant.audioTrackPublications.forEach(publication => {
        if (publication.isSubscribed && publication.track) {
          handleAudioTrack(publication, participant.identity);
        }
      });

      // 监听新的轨道订阅
      const onTrackSubscribed = (track: Track, publication: TrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          handleAudioTrack(publication, participant.identity);
        }
      };

      const onTrackUnsubscribed = (track: Track, publication: TrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          handleTrackUnsubscribed(publication, participant.identity);
        }
      };

      participant.on('trackSubscribed', onTrackSubscribed);
      participant.on('trackUnsubscribed', onTrackUnsubscribed);
    });

    // 监听参与者变化
    const onParticipantConnected = (participant: any) => {
      participant.audioTrackPublications.forEach((publication: TrackPublication) => {
        if (publication.isSubscribed && publication.track) {
          handleAudioTrack(publication, participant.identity);
        }
      });

      const onTrackSubscribed = (track: Track, publication: TrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          handleAudioTrack(publication, participant.identity);
        }
      };

      const onTrackUnsubscribed = (track: Track, publication: TrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          handleTrackUnsubscribed(publication, participant.identity);
        }
      };

      participant.on('trackSubscribed', onTrackSubscribed);
      participant.on('trackUnsubscribed', onTrackUnsubscribed);
    };

    const onParticipantDisconnected = (participant: any) => {
      // 清理该参与者的所有音频元素
      const keysToRemove: string[] = [];
      audioElements.forEach((element, key) => {
        if (key.startsWith(`${participant.identity}-`)) {
          element.pause();
          element.srcObject = null;
          element.remove();
          keysToRemove.push(key);
        }
      });
      keysToRemove.forEach(key => audioElements.delete(key));
    };

    room.on('participantConnected', onParticipantConnected);
    room.on('participantDisconnected', onParticipantDisconnected);

    return () => {
      cleanup();
      room.off('participantConnected', onParticipantConnected);
      room.off('participantDisconnected', onParticipantDisconnected);
      
      // 清理参与者事件监听器
      participants.forEach(participant => {
        participant.removeAllListeners('trackSubscribed');
        participant.removeAllListeners('trackUnsubscribed');
      });
    };
  }, [room, participants, excludeTrackNames, volume]);

  // 更新音量
  useEffect(() => {
    audioElementsRef.current.forEach(element => {
      element.volume = volume;
    });
  }, [volume]);

  return null; // 这个组件不渲染任何UI
}
