'use client';

import { StartAudio } from '@livekit/components-react';
import { FilteredAudioRenderer } from '@/components/livekit/filtered-audio-renderer';
import { AudioFilterDebug } from '@/components/livekit/audio-filter-debug';
import type { AppConfig } from '@/app-config';
import { SessionProvider } from '@/components/app/session-provider';
import { ViewController } from '@/components/app/view-controller';
import { Toaster } from '@/components/livekit/toaster';

interface AppProps {
  appConfig: AppConfig;
}

export function App({ appConfig }: AppProps) {
  return (
    <SessionProvider appConfig={appConfig}>
      <main className="grid h-svh grid-cols-1 place-content-center">
        <ViewController />
      </main>
      <StartAudio label="Start Audio" />
      <FilteredAudioRenderer excludeTrackNames={appConfig.excludeAudioTracks} />
      <AudioFilterDebug 
        excludeTrackNames={appConfig.excludeAudioTracks} 
        show={appConfig.showAudioFilterDebug} 
      />
      <Toaster />
    </SessionProvider>
  );
}
