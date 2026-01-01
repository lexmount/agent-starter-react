'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { TrackReference } from '@livekit/components-react';

interface SelectedVideoTrackState {
  trackReference: TrackReference | null;
  trackId: string | null;
  setSelectedTrack: (trackId: string, trackReference: TrackReference | null) => void;
  clearSelectedTrack: () => void;
}

const SelectedVideoTrackContext = createContext<SelectedVideoTrackState | null>(null);

export function SelectedVideoTrackProvider({ children }: { children: ReactNode }) {
  const [trackReference, setTrackReference] = useState<TrackReference | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);

  const setSelectedTrack = useCallback((newTrackId: string, newTrackReference: TrackReference | null) => {
    setTrackId(newTrackId);
    setTrackReference(newTrackReference);
  }, []);

  const clearSelectedTrack = useCallback(() => {
    setTrackId(null);
    setTrackReference(null);
  }, []);

  return (
    <SelectedVideoTrackContext.Provider
      value={{ trackReference, trackId, setSelectedTrack, clearSelectedTrack }}
    >
      {children}
    </SelectedVideoTrackContext.Provider>
  );
}

export function useSelectedVideoTrack() {
  const context = useContext(SelectedVideoTrackContext);
  if (!context) {
    // 如果没有 Provider，返回默认值
    return {
      trackReference: null,
      trackId: null,
      setSelectedTrack: () => {},
      clearSelectedTrack: () => {},
    };
  }
  return context;
}

