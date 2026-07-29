export type RemoteAudioTrackEntry<T> = {
  trackSid: string;
  participantIdentity: string;
  trackName: string;
  payload: T;
};

export function bindRemoteParticipantLifecycle<T>({
  attachParticipant,
  listParticipants,
  observeConnected,
  observeDisconnected,
  observeParticipantConnected,
  observeParticipantDisconnected,
  onParticipantDisconnected,
  onRoomDisconnected,
}: {
  attachParticipant(participant: T): () => void;
  listParticipants(): Iterable<T>;
  observeConnected(listener: () => void): () => void;
  observeDisconnected(listener: () => void): () => void;
  observeParticipantConnected(listener: (participant: T) => void): () => void;
  observeParticipantDisconnected(listener: (participant: T) => void): () => void;
  onParticipantDisconnected(participant: T): void;
  onRoomDisconnected(): void;
}): () => void {
  const participantCleanups = new Map<T, () => void>();

  const attach = (participant: T) => {
    if (participantCleanups.has(participant)) {
      return;
    }
    participantCleanups.set(participant, attachParticipant(participant));
  };

  const detach = (participant: T) => {
    participantCleanups.get(participant)?.();
    participantCleanups.delete(participant);
  };

  const detachAll = () => {
    participantCleanups.forEach((cleanup) => cleanup());
    participantCleanups.clear();
  };

  const reconcileParticipants = () => {
    for (const participant of listParticipants()) {
      attach(participant);
    }
  };

  const stopObserving = [
    observeConnected(reconcileParticipants),
    observeParticipantConnected(attach),
    observeParticipantDisconnected((participant) => {
      detach(participant);
      onParticipantDisconnected(participant);
    }),
    observeDisconnected(() => {
      detachAll();
      onRoomDisconnected();
    }),
  ];

  reconcileParticipants();

  return () => {
    stopObserving.forEach((stop) => stop());
    detachAll();
  };
}

export function createRemoteAudioTrackLifecycle<T>(callbacks: {
  attach(entry: RemoteAudioTrackEntry<T>): void;
  detach(entry: RemoteAudioTrackEntry<T>): void;
}): {
  subscribe(entry: RemoteAudioTrackEntry<T>): void;
  unsubscribe(trackSid: string): void;
  reconcile(entries: readonly RemoteAudioTrackEntry<T>[]): void;
  disconnect(participantIdentity: string): void;
  close(): void;
} {
  const activeEntries = new Map<string, RemoteAudioTrackEntry<T>>();

  const subscribe = (entry: RemoteAudioTrackEntry<T>) => {
    if (activeEntries.has(entry.trackSid)) {
      return;
    }

    callbacks.attach(entry);
    activeEntries.set(entry.trackSid, entry);
  };

  const unsubscribe = (trackSid: string) => {
    const entry = activeEntries.get(trackSid);
    if (!entry) {
      return;
    }

    activeEntries.delete(trackSid);
    callbacks.detach(entry);
  };

  return {
    subscribe,
    unsubscribe,
    reconcile(entries) {
      const nextTrackSids = new Set(entries.map((entry) => entry.trackSid));
      for (const trackSid of activeEntries.keys()) {
        if (!nextTrackSids.has(trackSid)) {
          unsubscribe(trackSid);
        }
      }
      entries.forEach(subscribe);
    },
    disconnect(participantIdentity) {
      for (const [trackSid, entry] of activeEntries) {
        if (entry.participantIdentity === participantIdentity) {
          unsubscribe(trackSid);
        }
      }
    },
    close() {
      for (const trackSid of activeEntries.keys()) {
        unsubscribe(trackSid);
      }
    },
  };
}
