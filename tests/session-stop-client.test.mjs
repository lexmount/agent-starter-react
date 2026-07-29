import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { WelcomeView } from '../components/app/welcome-view.tsx';

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

    const stopPromise = requestAgentSessionStop('11111111-2222-4333-8444-555555555555');
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

test('failed stop stays visible and the next start wait retries the same cleanup before continuing', async () => {
  const originalFetch = globalThis.fetch;
  const sessionId = '11111111-2222-4333-8444-555555555555';
  let fetchCount = 0;
  let releaseRetry;
  globalThis.fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return { ok: false, status: 502 };
    }
    return new Promise((resolve) => {
      releaseRetry = () => resolve({ ok: true, status: 200 });
    });
  };

  try {
    const {
      getAgentSessionStopError,
      getAgentSessionStopPending,
      requestAgentSessionStop,
      waitForAgentSessionStop,
    } = await loadSessionStopClientModule();

    assert.equal(typeof getAgentSessionStopError, 'function');
    await assert.rejects(requestAgentSessionStop(sessionId), /agent session stop failed: 502/);
    assert.match(getAgentSessionStopError(), /agent session stop failed: 502/);

    let startGateResolved = false;
    const startGatePromise = waitForAgentSessionStop().then(() => {
      startGateResolved = true;
    });
    for (let i = 0; i < 8 && fetchCount < 2; i++) {
      await Promise.resolve();
    }

    assert.equal(fetchCount, 2);
    assert.equal(getAgentSessionStopPending(), true);
    assert.equal(startGateResolved, false);
    assert.match(getAgentSessionStopError(), /agent session stop failed: 502/);

    releaseRetry();
    await startGatePromise;
    assert.equal(getAgentSessionStopPending(), false);
    assert.equal(getAgentSessionStopError(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed cleanup retry keeps the next start blocked and preserves the latest error', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return { ok: false, status: fetchCount === 1 ? 502 : 503 };
  };

  try {
    const { getAgentSessionStopError, requestAgentSessionStop, waitForAgentSessionStop } =
      await loadSessionStopClientModule();

    await assert.rejects(
      requestAgentSessionStop('11111111-2222-4333-8444-555555555555'),
      /agent session stop failed: 502/
    );
    await assert.rejects(waitForAgentSessionStop(), /agent session stop failed: 503/);

    assert.equal(fetchCount, 2);
    assert.match(getAgentSessionStopError(), /agent session stop failed: 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('welcome view renders a persistent cleanup failure while allowing a retry attempt', () => {
  const originalReact = globalThis.React;
  globalThis.React = React;
  try {
    const html = renderToStaticMarkup(
      React.createElement(WelcomeView, {
        startButtonText: 'Start call',
        onStartCall: () => {},
        stopError: 'Session cleanup failed',
      })
    );

    assert.match(html, /role="alert"/);
    assert.match(html, /Session cleanup failed/);
    assert.doesNotMatch(html, /disabled=""/);
  } finally {
    globalThis.React = originalReact;
  }
});

test('agent session stop sends only canonical session id to Next API', async () => {
  const originalFetch = globalThis.fetch;
  let postedBody;
  globalThis.fetch = async (_url, init) => {
    postedBody = JSON.parse(String(init.body));
    return { ok: true, status: 200 };
  };

  try {
    const { requestAgentSessionStop } = await loadSessionStopClientModule();

    await requestAgentSessionStop('11111111-2222-4333-8444-555555555555');

    assert.deepEqual(postedBody, {
      sessionId: '11111111-2222-4333-8444-555555555555',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent session stop does not release gateway sandbox sessions by default on public paths', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    location: {
      pathname: '/s/abc123/live',
    },
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method });
    return { ok: true, status: 200 };
  };

  try {
    const { requestAgentSessionStop } = await loadSessionStopClientModule();

    await requestAgentSessionStop('11111111-2222-4333-8444-555555555555');

    assert.deepEqual(calls, [{ url: 'api/session/stop', method: 'POST' }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('agent session stop ignores public sandbox paths during local cleanup', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    location: {
      pathname: '/',
    },
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method });
    return { ok: true, status: 200 };
  };

  try {
    const { beginAgentSessionStart, requestAgentSessionStop } = await loadSessionStopClientModule();
    const sessionId = '11111111-2222-4333-8444-555555555555';

    beginAgentSessionStart('room-a', sessionId);
    globalThis.window.location.pathname = '/s/abc123/live';

    await requestAgentSessionStop(sessionId);

    assert.deepEqual(calls, [{ url: 'api/session/stop', method: 'POST' }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('background agent session stop does not release gateway sandbox sessions', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    location: {
      pathname: '/s/abc123/live',
    },
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method });
    return { ok: true, status: 200 };
  };

  try {
    const { beginAgentSessionStart, requestAgentSessionStop } = await loadSessionStopClientModule();
    const sessionId = '11111111-2222-4333-8444-555555555555';

    beginAgentSessionStart('room-a', sessionId);
    await requestAgentSessionStop(sessionId, {
      waitForRemote: false,
    });
    for (let i = 0; i < 8 && calls.length < 1; i++) {
      await Promise.resolve();
    }

    assert.deepEqual(calls, [{ url: 'api/session/stop', method: 'POST' }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('agent session stop skips gateway release outside public sandbox paths', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    location: {
      pathname: '/',
    },
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method });
    return { ok: true, status: 200 };
  };

  try {
    const { requestAgentSessionStop } = await loadSessionStopClientModule();

    await requestAgentSessionStop('11111111-2222-4333-8444-555555555555');

    assert.deepEqual(calls, [{ url: 'api/session/stop', method: 'POST' }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
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
    const stopPromise = requestAgentSessionStop('11111111-2222-4333-8444-555555555555').then(() => {
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

    void requestAgentSessionStop('11111111-2222-4333-8444-555555555555', {
      waitForRemote: false,
    });
    await waitForAgentSessionStop();

    assert.equal(fetchCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('background cleanup without an active session does not consume a failed stop retry', async () => {
  const originalFetch = globalThis.fetch;
  const sessionId = '11111111-2222-4333-8444-555555555555';
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return {
      ok: fetchCount > 1,
      status: fetchCount > 1 ? 200 : 502,
    };
  };

  try {
    const { getAgentSessionStopError, requestAgentSessionStop, waitForAgentSessionStop } =
      await loadSessionStopClientModule();

    await assert.rejects(requestAgentSessionStop(sessionId), /agent session stop failed: 502/);
    await requestAgentSessionStop(null, { waitForRemote: false });
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }

    assert.equal(fetchCount, 1);
    assert.match(getAgentSessionStopError(), /agent session stop failed: 502/);

    await waitForAgentSessionStop();
    assert.equal(fetchCount, 2);
    assert.equal(getAgentSessionStopError(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('background cleanup for the same session does not erase a failed foreground stop', async () => {
  const originalFetch = globalThis.fetch;
  const sessionId = '11111111-2222-4333-8444-555555555555';
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return {
      ok: fetchCount > 1,
      status: fetchCount > 1 ? 200 : 502,
    };
  };

  try {
    const { getAgentSessionStopError, requestAgentSessionStop, waitForAgentSessionStop } =
      await loadSessionStopClientModule();

    await assert.rejects(requestAgentSessionStop(sessionId), /agent session stop failed: 502/);
    await requestAgentSessionStop(sessionId, { waitForRemote: false });
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }

    assert.equal(fetchCount, 2);
    assert.match(getAgentSessionStopError(), /agent session stop failed: 502/);

    await waitForAgentSessionStop();
    assert.equal(fetchCount, 3);
    assert.equal(getAgentSessionStopError(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('wait-for-remote stop clears active start before remote cleanup settles', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const releaseFetches = [];
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Promise((resolve) => {
      releaseFetches.push(() => resolve({ ok: true, status: 200 }));
    });
  };

  try {
    const { beginAgentSessionStart, getActiveAgentSession, requestAgentSessionStop } =
      await loadSessionStopClientModule();
    const sessionId = '11111111-2222-4333-8444-555555555555';

    beginAgentSessionStart('room-a', sessionId);
    const stopPromise = requestAgentSessionStop(sessionId, { waitForRemote: true });
    for (let i = 0; i < 8 && releaseFetches.length === 0; i++) {
      await Promise.resolve();
    }

    assert.equal(getActiveAgentSession(), null);
    void requestAgentSessionStop(null, { waitForRemote: false });
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }

    assert.equal(fetchCount, 1);
    releaseFetches.forEach((releaseFetch) => releaseFetch());
    await stopPromise;
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

test('view controller disables start while a session is active', async () => {
  const source = await readFile(
    new URL('../components/app/view-controller.tsx', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /const isStartDisabled = isSessionActive \|\| stopPending \|\| startPending/
  );
  assert.match(source, /startDisabled=\{isStartDisabled\}/);
});

test('view controller exposes cleanup failure without disabling the retry attempt', async () => {
  const source = await readFile(
    new URL('../components/app/view-controller.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /getAgentSessionStopError/);
  assert.match(source, /stopError=\{stopError\}/);
  assert.doesNotMatch(source, /const isStartDisabled = [^\n]*stopError/);
});

test('session start keeps the welcome view active until the cleanup gate succeeds', async () => {
  const source = await readFile(new URL('../hooks/useRoom.ts', import.meta.url), 'utf8');
  const startSessionSource = source.match(
    /const startSession = useCallback\(async \(\) => \{[\s\S]*?\n  }, \[/
  )?.[0];

  assert.ok(startSessionSource, 'startSession should be defined');
  assert.ok(
    startSessionSource.indexOf('await waitForAgentSessionStop();') <
      startSessionSource.indexOf('setIsSessionActive(true);')
  );
});

test('session lifecycle cancels in-flight dispatch before allowing next start', async () => {
  const source = await readFile(new URL('../lib/session-stop-client.ts', import.meta.url), 'utf8');

  assert.match(source, /beginAgentSessionStart/);
  assert.match(source, /registerAgentSessionDispatch/);
  assert.match(source, /cancelAgentSessionStart/);
  assert.match(source, /AbortController/);
  assert.match(source, /pendingStartPromise/);
  assert.match(source, /waitForAgentSessionStop/);
});

test('new session starts truncate the previous dispatch wait chain', async () => {
  const source = await readFile(new URL('../lib/session-stop-client.ts', import.meta.url), 'utf8');
  const beginStartSource = source.match(/export function beginAgentSessionStart[\s\S]*?\n}/)?.[0];

  assert.ok(beginStartSource, 'beginAgentSessionStart should be defined');
  assert.match(beginStartSource, /pendingStartPromise = Promise\.resolve\(\)/);
});

test('disconnect control exits the local session before remote stop finishes', async () => {
  const controlBarSource = await readFile(
    new URL('../components/livekit/agent-control-bar/agent-control-bar.tsx', import.meta.url),
    'utf8'
  );

  assert.match(controlBarSource, /getActiveAgentSession/);
  assert.match(controlBarSource, /getCurrentSessionId/);
  assert.match(controlBarSource, /registerAgentSessionLocalCleanup/);
  assert.match(controlBarSource, /requestAgentSessionStop\(sessionId\)/);
  assert.doesNotMatch(controlBarSource, /releaseGatewaySession/);
  assert.doesNotMatch(controlBarSource, /usesFastBrowserStop/);
  assert.doesNotMatch(controlBarSource, /waitForRemote:\s*!/);
  assert.doesNotMatch(controlBarSource, /await requestAgentSessionStop\(room\.name\)/);
  assert.doesNotMatch(controlBarSource, /requestAgentSessionStop\(room\.name,/);
});
