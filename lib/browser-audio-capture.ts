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

export type BrowserAudioCaptureObservabilityAttributes = Record<string, boolean | null>;

export interface BrowserAudioPlaybackDiagnostics {
  participantIdentity: string;
  trackName: string;
  activeAudioElementCount: number;
  paused: boolean;
  readyState: number;
}

type BrowserAudioElementState = Pick<HTMLAudioElement, 'ended' | 'paused' | 'readyState'>;

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

export function buildBrowserAudioCaptureObservabilityAttributes(
  diagnostics: BrowserAudioCaptureDiagnostics
): BrowserAudioCaptureObservabilityAttributes {
  return {
    'browser.audio.echo_cancellation.requested':
      BROWSER_AUDIO_CONSTRAINTS.echoCancellation === true,
    'browser.audio.echo_cancellation.supported': !!diagnostics.supported.echoCancellation,
    'browser.audio.echo_cancellation.constrained': readBooleanConstraint(
      diagnostics.constraints.echoCancellation
    ),
    'browser.audio.echo_cancellation.active': diagnostics.settings.echoCancellation ?? null,
    'browser.audio.noise_suppression.requested':
      BROWSER_AUDIO_CONSTRAINTS.noiseSuppression === true,
    'browser.audio.noise_suppression.supported': !!diagnostics.supported.noiseSuppression,
    'browser.audio.noise_suppression.constrained': readBooleanConstraint(
      diagnostics.constraints.noiseSuppression
    ),
    'browser.audio.noise_suppression.active': diagnostics.settings.noiseSuppression ?? null,
    'browser.audio.auto_gain_control.requested': BROWSER_AUDIO_CONSTRAINTS.autoGainControl === true,
    'browser.audio.auto_gain_control.supported': !!diagnostics.supported.autoGainControl,
    'browser.audio.auto_gain_control.constrained': readBooleanConstraint(
      diagnostics.constraints.autoGainControl
    ),
    'browser.audio.auto_gain_control.active': diagnostics.settings.autoGainControl ?? null,
  };
}

function readBooleanConstraint(value: ConstrainBoolean | undefined): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value && typeof value === 'object') {
    if (typeof value.exact === 'boolean') {
      return value.exact;
    }
    if (typeof value.ideal === 'boolean') {
      return value.ideal;
    }
  }
  return null;
}
