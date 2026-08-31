import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  BROWSER_AUDIO_CONSTRAINTS,
  assertBrowserEchoCancellationActive,
  buildBrowserAudioPlaybackDiagnostics,
  inspectBrowserAudioCapture,
  runWithBrowserAudioTrackCleanup,
} = await import('../lib/browser-audio-capture.ts');

test('browser audio capture requests WebRTC audio processing', () => {
  assert.deepEqual(BROWSER_AUDIO_CONSTRAINTS, {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
});

test('browser audio capture reports requested and effective settings', () => {
  const diagnostics = inspectBrowserAudioCapture(
    {
      id: 'audio-track-1',
      getConstraints: () => BROWSER_AUDIO_CONSTRAINTS,
      getSettings: () => ({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      }),
    },
    {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
  );

  assert.equal(diagnostics.trackId, 'audio-track-1');
  assert.equal(diagnostics.settings.echoCancellation, true);
  assert.equal(diagnostics.settings.noiseSuppression, true);
  assert.deepEqual(diagnostics.constraints, BROWSER_AUDIO_CONSTRAINTS);
});

test('browser audio capture fails when supported AEC is not effective', () => {
  const diagnostics = inspectBrowserAudioCapture(
    {
      id: 'audio-track-2',
      getConstraints: () => BROWSER_AUDIO_CONSTRAINTS,
      getSettings: () => ({ echoCancellation: false }),
    },
    { echoCancellation: true }
  );

  assert.equal(diagnostics.settings.echoCancellation, false);
  assert.throws(
    () => assertBrowserEchoCancellationActive(diagnostics),
    /echo cancellation was requested but is not active/i
  );
});

test('browser audio capture does not claim unsupported AEC is active', () => {
  const diagnostics = inspectBrowserAudioCapture(
    {
      id: 'audio-track-3',
      getConstraints: () => BROWSER_AUDIO_CONSTRAINTS,
      getSettings: () => ({}),
    },
    { echoCancellation: false }
  );

  assert.equal(diagnostics.supported.echoCancellation, false);
  assert.equal(diagnostics.settings.echoCancellation, undefined);
  assert.doesNotThrow(() => assertBrowserEchoCancellationActive(diagnostics));
});

test('audio capture failure disables, mutes, and stops the acquired track', async () => {
  const calls = [];
  const audioTrack = {
    mediaStreamTrack: { enabled: true },
    mute() {
      calls.push('mute');
      return new Promise(() => {});
    },
    stop() {
      calls.push('stop');
    },
  };

  await assert.rejects(
    runWithBrowserAudioTrackCleanup(audioTrack, async () => {
      throw new Error('AEC is not active');
    }),
    /AEC is not active/
  );

  assert.equal(audioTrack.mediaStreamTrack.enabled, false);
  assert.deepEqual(calls, ['mute', 'stop']);
});

test('successful audio capture is left owned by the active runtime', async () => {
  const calls = [];
  const audioTrack = {
    mediaStreamTrack: { enabled: true },
    async mute() {
      calls.push('mute');
    },
    stop() {
      calls.push('stop');
    },
  };

  const result = await runWithBrowserAudioTrackCleanup(audioTrack, async () => 'published');

  assert.equal(result, 'published');
  assert.equal(audioTrack.mediaStreamTrack.enabled, true);
  assert.deepEqual(calls, []);
});

test('browser playback diagnostics identify the active output and element count', () => {
  const playingElement = { paused: false, ended: false, readyState: 4 };
  const pausedElement = { paused: true, ended: false, readyState: 4 };

  assert.deepEqual(
    buildBrowserAudioPlaybackDiagnostics(
      'agent-AJ_123',
      'roomio_audio',
      [playingElement, pausedElement],
      playingElement
    ),
    {
      participantIdentity: 'agent-AJ_123',
      trackName: 'roomio_audio',
      activeAudioElementCount: 1,
      paused: false,
      readyState: 4,
    }
  );
});
