import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

async function loadSessionStopClientModule({ stopSettleMs = 0 } = {}) {
  globalThis.__LEXVOICE_SESSION_STOP_SETTLE_MS__ = stopSettleMs;
  const source = await readFile(new URL('../lib/session-stop-client.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });

  return import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}#${randomUUID()}`
  );
}

test('waits for an in-flight agent session stop before continuing', async () => {
  const originalFetch = globalThis.fetch;
  let releaseFetch;
  globalThis.fetch = async () =>
    new Promise((resolve) => {
      releaseFetch = () => resolve({ ok: true, status: 200 });
    });

  try {
    const { requestAgentSessionStop, waitForAgentSessionStop } =
      await loadSessionStopClientModule();

    const stopPromise = requestAgentSessionStop('voice_assistant_room_1');
    let waitResolved = false;
    const waitPromise = waitForAgentSessionStop().then(() => {
      waitResolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    assert.equal(waitResolved, false);

    releaseFetch();
    await stopPromise;
    await waitPromise;
    assert.equal(waitResolved, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('clears visible stop pending while keeping start gated during worker settle', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let settleCallback;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  globalThis.setTimeout = (callback, delay, ...args) => {
    assert.equal(delay, 1000);
    settleCallback = () => callback(...args);
    return 1;
  };

  try {
    const { getAgentSessionStopPending, requestAgentSessionStop, waitForAgentSessionStop } =
      await loadSessionStopClientModule({ stopSettleMs: 1000 });

    let stopResolved = false;
    const stopPromise = requestAgentSessionStop('voice_assistant_room_1').then(() => {
      stopResolved = true;
    });
    let gateResolved = false;
    const gatePromise = waitForAgentSessionStop().then(() => {
      gateResolved = true;
    });

    for (let i = 0; i < 8 && !settleCallback; i++) {
      await Promise.resolve();
    }
    assert.equal(getAgentSessionStopPending(), false);
    assert.equal(stopResolved, false);
    assert.equal(gateResolved, false);
    assert.equal(typeof settleCallback, 'function');

    settleCallback();
    await stopPromise;
    await gatePromise;
    assert.equal(getAgentSessionStopPending(), false);
    assert.equal(stopResolved, true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('browser stop does not gate the next start on remote cleanup', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () =>
    new Promise(() => {
      fetchCalled = true;
    });

  try {
    const { requestAgentSessionStop, waitForAgentSessionStop } =
      await loadSessionStopClientModule();

    void requestAgentSessionStop('voice_assistant_room_1', undefined, {
      waitForRemote: false,
    });
    await waitForAgentSessionStop();

    assert.equal(fetchCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('welcome start button shows disabled pending cleanup state', async () => {
  const source = await readFile(
    new URL('../components/app/welcome-view.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /startDisabled\?: boolean/);
  assert.match(source, /startPending\?: boolean/);
  assert.match(source, /startPendingLabel\?: string/);
  assert.match(source, /disabled=\{startDisabled\}/);
  assert.match(source, /startPending \? startPendingLabel : startButtonText/);
});

test('session lifecycle cancels in-flight dispatch before stop releases next start', async () => {
  const source = await readFile(new URL('../lib/session-stop-client.ts', import.meta.url), 'utf8');

  assert.match(source, /beginAgentSessionStart/);
  assert.match(source, /registerAgentSessionDispatch/);
  assert.match(source, /cancelAgentSessionStart/);
  assert.match(source, /AbortController/);
  assert.match(source, /pendingStartPromise/);
  assert.match(source, /waitForAgentSessionStop/);
});

test('disconnect control exits the local session before remote stop finishes', async () => {
  const controlBarSource = await readFile(
    new URL('../components/livekit/agent-control-bar/agent-control-bar.tsx', import.meta.url),
    'utf8'
  );

  assert.match(controlBarSource, /getActiveAgentSession/);
  assert.match(controlBarSource, /registerAgentSessionLocalCleanup/);
  assert.match(
    controlBarSource,
    /requestAgentSessionStop\(room\.name,\s*activeSession\?\.sessionId,\s*\{\s*waitForRemote:\s*!usesFastBrowserStop,\s*\}\)/
  );
  assert.doesNotMatch(controlBarSource, /await requestAgentSessionStop\(room\.name\)/);
});
