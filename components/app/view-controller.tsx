'use client';

import { useState, useSyncExternalStore } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { AiFrontdesk } from '@/components/agentwidget/ai-frontdesk';
import { useSession } from '@/components/app/session-provider';
import { getAgentSessionStopPending, subscribeAgentSessionStop } from '@/lib/session-stop-client';

export function ViewController() {
  const room = useRoomContext();
  const { isSessionActive, startSession } = useSession();
  const [startPending, setStartPending] = useState(false);
  const stopPending = useSyncExternalStore(
    subscribeAgentSessionStop,
    getAgentSessionStopPending,
    getAgentSessionStopPending
  );
  const isStartDisabled = isSessionActive || stopPending || startPending;

  const handleStartCall = () => {
    if (isStartDisabled) {
      return;
    }

    // Preserve browser autoplay authority while the call still runs inside
    // the user's click gesture. Connecting the room first can lose it.
    void room.startAudio().catch((error: unknown) => {
      console.warn('Unable to unlock room audio from the start-call gesture', error);
    });

    void (async () => {
      setStartPending(true);
      try {
        await startSession();
      } finally {
        setStartPending(false);
      }
    })();
  };

  return (
    <AiFrontdesk
      onStartCall={handleStartCall}
      startDisabled={isStartDisabled}
      startPending={stopPending || startPending}
    />
  );
}
