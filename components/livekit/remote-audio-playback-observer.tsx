'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  ParticipantEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  RoomEvent,
  Track,
} from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { startMediaTrackAudioObserver } from '@/lib/frontend-audio-observer';
import {
  FRONTEND_EVENTS,
  OBSERVABILITY_ATTRS,
  ObservabilityAttribute,
  outputSegmentAttributesFromMarker,
  parseBackendObservabilityMarkerPayload,
  publishFrontendObservabilityEvent,
} from '@/lib/observability';

interface RemoteAudioPlaybackObserverProps {
  excludeTrackNames?: string[];
  observabilityEnabled?: boolean;
}

function buildObserverKey(participantIdentity: string, publication: RemoteTrackPublication) {
  return `${participantIdentity}-${publication.trackSid || publication.trackName}`;
}

function participantSegmentKey(participantIdentity: string) {
  return `participant:${participantIdentity}`;
}

function shouldExcludeTrack(publication: RemoteTrackPublication, excludeTrackNames: string[]) {
  const trackName = publication.trackName || publication.trackSid;
  return excludeTrackNames.some(
    (excludeName) =>
      trackName.includes(excludeName) ||
      trackName === excludeName ||
      publication.trackSid === excludeName
  );
}

export function RemoteAudioPlaybackObserver({
  excludeTrackNames = [],
  observabilityEnabled,
}: RemoteAudioPlaybackObserverProps) {
  const room = useRoomContext();
  const observersRef = useRef<Map<string, () => void>>(new Map());
  const outputSegmentsRef = useRef<Map<string, Record<string, ObservabilityAttribute>>>(new Map());

  const recordFrontendObservability = useCallback(
    (name: string, attributes?: Record<string, ObservabilityAttribute>) => {
      void publishFrontendObservabilityEvent({
        enabled: !!observabilityEnabled,
        room,
        name,
        attributes,
      }).catch((error) => {
        console.warn('[frontend-observability] failed to publish event', error);
      });
    },
    [observabilityEnabled, room]
  );

  useEffect(() => {
    const observers = observersRef.current;
    const outputSegments = outputSegmentsRef.current;
    const stopObserver = (key: string) => {
      observers.get(key)?.();
      observers.delete(key);
    };
    const stopAllObservers = () => {
      observers.forEach((stop) => stop());
      observers.clear();
    };
    const activeSegmentAttributes = (participantIdentity: string) =>
      outputSegments.get(participantSegmentKey(participantIdentity)) ?? {};

    if (!room || !observabilityEnabled) {
      stopAllObservers();
      return;
    }

    const observeAudioTrack = (
      publication: RemoteTrackPublication,
      participantIdentity: string
    ) => {
      if (publication.kind !== Track.Kind.Audio || !publication.track) {
        return;
      }

      const key = buildObserverKey(participantIdentity, publication);
      if (shouldExcludeTrack(publication, excludeTrackNames)) {
        stopObserver(key);
        return;
      }
      if (observers.has(key)) {
        return;
      }

      const trackName = publication.trackName || publication.trackSid;
      observers.set(
        key,
        startMediaTrackAudioObserver({
          mediaStreamTrack: publication.track.mediaStreamTrack,
          startEventName: FRONTEND_EVENTS.REPLY_AUDIO_PLAYBACK_STARTED,
          endEventName: FRONTEND_EVENTS.REPLY_AUDIO_PLAYBACK_ENDED,
          emit: recordFrontendObservability,
          attributes: () => ({
            [OBSERVABILITY_ATTRS.FRONTEND_AUDIO_DIRECTION]: 'output',
            'livekit.participant_identity': participantIdentity,
            'livekit.track_name': trackName,
            'livekit.track_sid': publication.trackSid,
            'livekit.track_source': String(publication.source),
            ...activeSegmentAttributes(participantIdentity),
          }),
          startThreshold: 0.012,
          endThreshold: 0.004,
          startDurationMs: 40,
          endSilenceMs: 350,
        }).stop
      );
    };

    const handleTrackUnsubscribed = (
      publication: RemoteTrackPublication,
      participantIdentity: string
    ) => {
      if (publication.kind !== Track.Kind.Audio) return;
      stopObserver(buildObserverKey(participantIdentity, publication));
    };

    const participantListenerCleanups: Array<() => void> = [];

    const attachParticipantListeners = (participant: RemoteParticipant) => {
      participant.audioTrackPublications.forEach((publication) => {
        if (publication.isSubscribed && publication.track) {
          observeAudioTrack(publication, participant.identity);
        }
      });

      const onTrackSubscribed = (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          observeAudioTrack(publication, participant.identity);
        }
      };

      const onTrackUnsubscribed = (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          handleTrackUnsubscribed(publication, participant.identity);
        }
      };

      participant.on(ParticipantEvent.TrackSubscribed, onTrackSubscribed);
      participant.on(ParticipantEvent.TrackUnsubscribed, onTrackUnsubscribed);

      participantListenerCleanups.push(() => {
        participant.off(ParticipantEvent.TrackSubscribed, onTrackSubscribed);
        participant.off(ParticipantEvent.TrackUnsubscribed, onTrackUnsubscribed);
      });
    };

    room.remoteParticipants.forEach(attachParticipantListeners);

    const onParticipantConnected = (participant: RemoteParticipant) => {
      attachParticipantListeners(participant);
    };

    const onParticipantDisconnected = (participant: RemoteParticipant) => {
      const prefix = `${participant.identity}-`;
      for (const key of observers.keys()) {
        if (key.startsWith(prefix)) {
          stopObserver(key);
        }
      }
      outputSegments.delete(participantSegmentKey(participant.identity));
    };

    const onDataReceived = (
      payload: Uint8Array,
      participant?: { identity?: string },
      _kind?: unknown,
      topic?: string
    ) => {
      const marker = parseBackendObservabilityMarkerPayload(payload, topic);
      if (!marker) {
        return;
      }
      const attributes = outputSegmentAttributesFromMarker(marker);
      const markerParticipant = String(
        marker.attributes['livekit.participant_identity'] ||
          marker.attributes['livekit.participant'] ||
          participant?.identity ||
          ''
      ).trim();
      if (!markerParticipant || !attributes[OBSERVABILITY_ATTRS.OUTPUT_SEGMENT_ID]) {
        return;
      }
      outputSegments.set(participantSegmentKey(markerParticipant), attributes);
    };

    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.DataReceived, onDataReceived);

    return () => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.DataReceived, onDataReceived);
      participantListenerCleanups.forEach((cleanup) => cleanup());
      stopAllObservers();
    };
  }, [room, observabilityEnabled, excludeTrackNames, recordFrontendObservability]);

  return null;
}
