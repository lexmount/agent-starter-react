import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserVideoMirrorProcessor } from '../lib/browser-video-mirror-processor.ts';

test('browser video mirror processor publishes one horizontally mirrored canvas track', async (t) => {
  const drawCalls = [];
  let frameCallback;
  let cancelledFrameId;
  let stopped = false;
  const processedTrack = {
    stop() {
      stopped = true;
    },
  };
  const context = {
    clearRect(...args) {
      drawCalls.push(['clearRect', ...args]);
    },
    drawImage(...args) {
      drawCalls.push(['drawImage', ...args]);
    },
    setTransform(...args) {
      drawCalls.push(['setTransform', ...args]);
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext(kind) {
      assert.equal(kind, '2d');
      return context;
    },
    captureStream(frameRate) {
      assert.equal(frameRate, 25);
      return {
        getVideoTracks() {
          return [processedTrack];
        },
      };
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, 'canvas');
      return canvas;
    },
  };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  const element = {
    requestVideoFrameCallback(callback) {
      frameCallback = callback;
      return 7;
    },
    cancelVideoFrameCallback(frameId) {
      cancelledFrameId = frameId;
    },
  };
  const sourceTrack = {
    getSettings() {
      return { width: 640, height: 480, frameRate: 25 };
    },
  };
  const processor = createBrowserVideoMirrorProcessor();

  await processor.init({ kind: 'video', track: sourceTrack, element });

  assert.equal(processor.processedTrack, processedTrack);
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 480);
  frameCallback();
  assert.deepEqual(drawCalls, [
    ['clearRect', 0, 0, 640, 480],
    ['setTransform', -1, 0, 0, 1, 640, 0],
    ['drawImage', element, 0, 0, 640, 480],
    ['setTransform', 1, 0, 0, 1, 0, 0],
  ]);

  await processor.destroy();

  assert.equal(cancelledFrameId, 7);
  assert.equal(stopped, true);
});
