export const BROWSER_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

type InspectableAudioTrack = Pick<MediaStreamTrack, 'id' | 'getConstraints' | 'getSettings'>;

export interface BrowserAudioCaptureDiagnostics {
  trackId: string;
  supported: MediaTrackSupportedConstraints;
  constraints: MediaTrackConstraints;
  settings: MediaTrackSettings;
}

export interface BrowserAudioPlaybackDiagnostics {
  participantIdentity: string;
  trackName: string;
  activeAudioElementCount: number;
  paused: boolean;
  readyState: number;
}

type BrowserAudioElementState = Pick<HTMLAudioElement, 'ended' | 'paused' | 'readyState'>;

export interface CleanableBrowserAudioTrack {
  mediaStreamTrack: { enabled: boolean };
  mute: () => Promise<unknown>;
  stop: () => void;
}

export async function runWithBrowserAudioTrackCleanup<T>(
  audioTrack: CleanableBrowserAudioTrack,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    audioTrack.mediaStreamTrack.enabled = false;
    void audioTrack.mute().catch(() => undefined);
    audioTrack.stop();
    throw error;
  }
}

export function buildBrowserAudioPlaybackDiagnostics(
  participantIdentity: string,
  trackName: string,
  audioElements: Iterable<BrowserAudioElementState>,
  currentElement: BrowserAudioElementState
): BrowserAudioPlaybackDiagnostics {
  return {
    participantIdentity,
    trackName,
    activeAudioElementCount: Array.from(audioElements).filter(
      (element) => !element.paused && !element.ended && element.readyState >= 2
    ).length,
    paused: currentElement.paused,
    readyState: currentElement.readyState,
  };
}

export function inspectBrowserAudioCapture(
  track: InspectableAudioTrack,
  supported: MediaTrackSupportedConstraints
): BrowserAudioCaptureDiagnostics {
  const constraints = track.getConstraints();
  const settings = track.getSettings();

  return {
    trackId: track.id,
    supported,
    constraints,
    settings,
  };
}

export function assertBrowserEchoCancellationActive(
  diagnostics: BrowserAudioCaptureDiagnostics
): void {
  if (diagnostics.supported.echoCancellation && diagnostics.settings.echoCancellation !== true) {
    throw new Error(
      'Browser echo cancellation was requested but is not active on the microphone track.'
    );
  }
}
