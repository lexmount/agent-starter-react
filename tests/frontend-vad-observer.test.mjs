import assert from 'node:assert/strict';
import { test } from 'node:test';

const { startMediaTrackVadObserver } = await import('../lib/frontend-vad-observer.ts');

test('media track vad observer uses the supplied track and emits speech events', async () => {
  const originalMediaStream = globalThis.MediaStream;
  const events = [];
  let sourceTrackStopCount = 0;
  let endedListener;
  const track = {
    id: 'browser-audio-track',
    addEventListener(eventName, listener) {
      if (eventName === 'ended') endedListener = listener;
    },
    removeEventListener(eventName, listener) {
      if (eventName === 'ended' && endedListener === listener) endedListener = undefined;
    },
    stop() {
      sourceTrackStopCount += 1;
    },
  };
  let capturedOptions;
  let startCount = 0;
  let pauseCount = 0;
  let destroyCount = 0;
  let now = 10_000;

  globalThis.MediaStream = class FakeMediaStream {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };

  try {
    const observer = await startMediaTrackVadObserver({
      mediaStreamTrack: track,
      now: () => now,
      createMicVad: async (options) => {
        capturedOptions = options;
        return {
          start() {
            startCount += 1;
          },
          pause() {
            pauseCount += 1;
          },
          destroy() {
            destroyCount += 1;
          },
        };
      },
      onSpeechStart: (event) => events.push(['start', event]),
      onSpeechEnd: (event) => events.push(['end', event]),
    });

    const stream = await capturedOptions.getStream();
    assert.deepEqual(stream.tracks, [track]);
    assert.equal(capturedOptions.model, 'v5');
    assert.equal(capturedOptions.startOnLoad, false);
    await capturedOptions.pauseStream(stream);
    assert.equal(sourceTrackStopCount, 0);
    assert.equal(await capturedOptions.resumeStream(stream), stream);
    assert.equal(startCount, 1);

    now = 12_345;
    capturedOptions.onSpeechStart();
    now = 12_500;
    now = 12_789;
    capturedOptions.onSpeechEnd(new Float32Array(1600));

    assert.deepEqual(events, [
      [
        'start',
        {
          timestampMs: 12_345,
          provider: 'vad-web',
          model: 'silero_vad_v5',
        },
      ],
      [
        'end',
        {
          timestampMs: 12_789,
          confirmationTimestampMs: 12_789,
          provider: 'vad-web',
          model: 'silero_vad_v5',
          audioDurationMs: 100,
        },
      ],
    ]);

    assert.equal(typeof endedListener, 'function');
    endedListener();
    observer.stop();
    assert.equal(pauseCount, 1);
    assert.equal(destroyCount, 1);
    assert.equal(endedListener, undefined);
  } finally {
    globalThis.MediaStream = originalMediaStream;
  }
});
