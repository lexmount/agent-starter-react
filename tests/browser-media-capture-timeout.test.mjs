import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  BrowserMediaCaptureTimeoutError,
  awaitBrowserMediaCapture,
} from '../lib/browser-media-capture-timeout.ts';

test('browser media capture times out instead of leaving Start Call pending forever', async () => {
  let resolveCapture;
  let stopped = false;
  const capture = new Promise((resolve) => {
    resolveCapture = resolve;
  });

  await assert.rejects(
    awaitBrowserMediaCapture(capture, {
      timeoutMs: 5,
      label: 'camera',
      disposeLateResult: (track) => track.stop(),
    }),
    (error) =>
      error instanceof BrowserMediaCaptureTimeoutError &&
      error.message === 'camera capture did not become ready within 5ms'
  );

  resolveCapture({ stop: () => (stopped = true) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stopped, true, 'a track that arrives after timeout must be stopped');
});

test('browser media capture returns an on-time result without disposing it', async () => {
  let stopped = false;
  const track = { stop: () => (stopped = true) };

  assert.equal(
    await awaitBrowserMediaCapture(Promise.resolve(track), {
      timeoutMs: 50,
      label: 'camera',
      disposeLateResult: (value) => value.stop(),
    }),
    track
  );
  assert.equal(stopped, false);
});

test('browser video capture and publication are both bounded startup steps', async () => {
  const source = await readFile(
    new URL('../hooks/useBrowserSourceClient.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /label: 'camera'/);
  assert.match(source, /label: 'camera publish'/);
});
