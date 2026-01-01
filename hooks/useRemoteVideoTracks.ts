'use client';

import { useCallback, useEffect, useState } from 'react';
import { RemoteTrackPublication, RemoteVideoTrack, Track } from 'livekit-client';
import { useRemoteParticipants, useRoomContext } from '@livekit/components-react';

export interface RemoteVideoTrackInfo {
  trackName: string;
  trackSid: string;
  participantIdentity: string;
  track: RemoteVideoTrack | null;
  publication: RemoteTrackPublication;
  isSubscribed: boolean;
}

export interface UseRemoteVideoTracksReturn {
  remoteVideoTracks: Map<string, RemoteVideoTrackInfo>;
  subscribeToTrack: (trackName: string) => Promise<boolean>;
  unsubscribeFromTrack: (trackName: string) => Promise<boolean>;
  getTrackByName: (trackName: string) => RemoteVideoTrackInfo | undefined;
  refreshTracks: () => void;
}

/**
 * Hook to manage remote video tracks from LiveKit participants
 * 管理来自 LiveKit 参与者的远程视频轨道
 */
export function useRemoteVideoTracks(): UseRemoteVideoTracksReturn {
  const room = useRoomContext();
  const participants = useRemoteParticipants();
  const [remoteVideoTracks, setRemoteVideoTracks] = useState<Map<string, RemoteVideoTrackInfo>>(
    new Map()
  );

  // 刷新轨道列表
  const refreshTracks = useCallback(() => {
    const tracks = new Map<string, RemoteVideoTrackInfo>();

    participants.forEach((participant) => {
      participant.videoTrackPublications.forEach((publication) => {
        const trackName = publication.trackName || publication.trackSid;
        const trackInfo: RemoteVideoTrackInfo = {
          trackName,
          trackSid: publication.trackSid,
          participantIdentity: participant.identity,
          track: publication.track as RemoteVideoTrack | null,
          publication,
          isSubscribed: publication.isSubscribed,
        };
        tracks.set(trackName, trackInfo);
      });
    });

    setRemoteVideoTracks(tracks);
    console.log(
      `[useRemoteVideoTracks] Found ${tracks.size} remote video tracks:`,
      Array.from(tracks.keys())
    );
  }, [participants]);

  // 订阅指定轨道
  const subscribeToTrack = useCallback(
    async (trackName: string): Promise<boolean> => {
      const trackInfo = remoteVideoTracks.get(trackName);
      if (!trackInfo) {
        console.warn(`[useRemoteVideoTracks] Track "${trackName}" not found`);
        return false;
      }

      if (trackInfo.isSubscribed) {
        console.log(`[useRemoteVideoTracks] Track "${trackName}" is already subscribed`);
        return true;
      }

      try {
        trackInfo.publication.setSubscribed(true);
        console.log(`[useRemoteVideoTracks] Successfully subscribed to track: ${trackName}`);
        return true;
      } catch (error) {
        console.error(`[useRemoteVideoTracks] Failed to subscribe to track "${trackName}":`, error);
        return false;
      }
    },
    [remoteVideoTracks]
  );

  // 取消订阅指定轨道
  const unsubscribeFromTrack = useCallback(
    async (trackName: string): Promise<boolean> => {
      const trackInfo = remoteVideoTracks.get(trackName);
      if (!trackInfo) {
        console.warn(`[useRemoteVideoTracks] Track "${trackName}" not found`);
        return false;
      }

      if (!trackInfo.isSubscribed) {
        console.log(`[useRemoteVideoTracks] Track "${trackName}" is already unsubscribed`);
        return true;
      }

      try {
        trackInfo.publication.setSubscribed(false);
        console.log(`[useRemoteVideoTracks] Successfully unsubscribed from track: ${trackName}`);
        return true;
      } catch (error) {
        console.error(
          `[useRemoteVideoTracks] Failed to unsubscribe from track "${trackName}":`,
          error
        );
        return false;
      }
    },
    [remoteVideoTracks]
  );

  // 根据名称获取轨道信息
  const getTrackByName = useCallback(
    (trackName: string): RemoteVideoTrackInfo | undefined => {
      return remoteVideoTracks.get(trackName);
    },
    [remoteVideoTracks]
  );

  // 监听参与者和轨道变化
  useEffect(() => {
    if (!room) return;

    // 初始化轨道列表
    refreshTracks();

    // 监听轨道订阅事件
    const handleTrackSubscribed = (track: Track, publication: RemoteTrackPublication) => {
      if (track.kind === Track.Kind.Video) {
        console.log(
          `[useRemoteVideoTracks] Video track subscribed: ${publication.trackName || publication.trackSid}`
        );
        refreshTracks();
      }
    };

    const handleTrackUnsubscribed = (track: Track, publication: RemoteTrackPublication) => {
      if (track.kind === Track.Kind.Video) {
        console.log(
          `[useRemoteVideoTracks] Video track unsubscribed: ${publication.trackName || publication.trackSid}`
        );
        refreshTracks();
      }
    };

    const handleTrackPublished = (publication: RemoteTrackPublication) => {
      if (publication.kind === Track.Kind.Video) {
        console.log(
          `[useRemoteVideoTracks] Video track published: ${publication.trackName || publication.trackSid}`
        );
        refreshTracks();
      }
    };

    const handleTrackUnpublished = (publication: RemoteTrackPublication) => {
      if (publication.kind === Track.Kind.Video) {
        console.log(
          `[useRemoteVideoTracks] Video track unpublished: ${publication.trackName || publication.trackSid}`
        );
        refreshTracks();
      }
    };

    // 监听现有参与者的事件
    participants.forEach((participant) => {
      participant.on('trackSubscribed', handleTrackSubscribed);
      participant.on('trackUnsubscribed', handleTrackUnsubscribed);
      participant.on('trackPublished', handleTrackPublished);
      participant.on('trackUnpublished', handleTrackUnpublished);
    });

    // 监听参与者连接/断开
    const handleParticipantConnected = (participant: any) => {
      console.log(`[useRemoteVideoTracks] Participant connected: ${participant.identity}`);
      participant.on('trackSubscribed', handleTrackSubscribed);
      participant.on('trackUnsubscribed', handleTrackUnsubscribed);
      participant.on('trackPublished', handleTrackPublished);
      participant.on('trackUnpublished', handleTrackUnpublished);
      refreshTracks();
    };

    const handleParticipantDisconnected = (participant: any) => {
      console.log(`[useRemoteVideoTracks] Participant disconnected: ${participant.identity}`);
      refreshTracks();
    };

    room.on('participantConnected', handleParticipantConnected);
    room.on('participantDisconnected', handleParticipantDisconnected);

    return () => {
      // 清理事件监听器
      participants.forEach((participant) => {
        participant.removeAllListeners('trackSubscribed');
        participant.removeAllListeners('trackUnsubscribed');
        participant.removeAllListeners('trackPublished');
        participant.removeAllListeners('trackUnpublished');
      });

      room.off('participantConnected', handleParticipantConnected);
      room.off('participantDisconnected', handleParticipantDisconnected);
    };
  }, [room, participants, refreshTracks]);

  return {
    remoteVideoTracks,
    subscribeToTrack,
    unsubscribeFromTrack,
    getTrackByName,
    refreshTracks,
  };
}
